import { createHash } from "node:crypto"
import type { IncomingMessage } from "node:http"
import { BlockList, isIP } from "node:net"

/**
 * An address as a rate-limit key: itself when it is an IP address, otherwise
 * a short hash of it, so a header of any length costs the same few bytes.
 */
function addressKey(value: string): string {
  return isIP(value)
    ? value
    : `h:${createHash("sha256").update(value).digest("hex").slice(0, 32)}`
}

function family(address: string): "ipv4" | "ipv6" | null {
  const version = isIP(address)
  return version === 4 ? "ipv4" : version === 6 ? "ipv6" : null
}

/** An IPv4 address a dual-stack socket reports as ::ffff:a.b.c.d. */
function unmapped(address: string): string {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1]
  return v4 && isIP(v4) === 4 ? v4 : address
}

/**
 * The proxies in front of an app: IP addresses and CIDR ranges,
 * comma-separated, with loopback always among them. An entry that is
 * neither is left out and reported through `onInvalid`.
 */
export function parseTrustedProxies(
  raw: string,
  onInvalid: (entry: string) => void = () => {},
): BlockList {
  const list = new BlockList()
  list.addSubnet("127.0.0.0", 8, "ipv4")
  list.addAddress("::1", "ipv6")

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim()
    if (!trimmed) continue

    const [address = "", prefix, ...rest] = trimmed.split("/")
    const type = family(address)
    const bits = prefix === undefined ? null : Number(prefix)
    const valid =
      type !== null &&
      rest.length === 0 &&
      (prefix === undefined ||
        (/^\d{1,3}$/.test(prefix) &&
          bits !== null &&
          bits <= (type === "ipv4" ? 32 : 128)))

    if (!valid || type === null) {
      onInvalid(trimmed)
      continue
    }

    if (bits === null) list.addAddress(address, type)
    else list.addSubnet(address, bits, type)
  }

  return list
}

const cache = new Map<string, BlockList>()

function trustedList(raw: string): BlockList {
  let list = cache.get(raw)
  if (!list) {
    list = parseTrustedProxies(raw, (entry) =>
      console.warn(
        `trusted proxies: "${entry}" is not an IP address or a CIDR range; it is ignored.`,
      ),
    )
    cache.set(raw, list)
  }
  return list
}

export type ClientIpOptions = {
  /** Proxy addresses and CIDR ranges (loopback is always among them). */
  trustedProxies?: string
  /** Entries in from the right of X-Forwarded-For when none are trusted. */
  hops?: number
  /**
   * The address that connected to the app (the socket peer), already
   * extracted by the caller. Without it, forwarded headers are believed as
   * before.
   */
  peer?: string
  /**
   * The header the app's own server stamped the peer into (see
   * `stampPeer`); read when `peer` is not given. The app must strip any
   * incoming copy first, or a client could name itself.
   */
  peerHeader?: string
  /**
   * The header the app's own server stamped (see `stampPeer`'s
   * `forwardedHeader`) to say the client really sent X-Forwarded-For or
   * X-Real-IP. Frameworks such as Next.js fill X-Forwarded-For with the raw
   * socket address when a request has none, which would make a direct client
   * look like forwarded headers from an untrusted peer. When given, and that
   * header is absent while a peer is known, forwarded headers are ignored:
   * the peer is the answer and `untrustedForwarded` is false. Without it
   * nothing changes.
   */
  forwardedHeader?: string
}

export type ClientIp = {
  /** The rate-limit key: an IP address, a short hash, or "local". */
  ip: string
  /**
   * Where it came from: "peer" (the connecting address), "forwarded"
   * (X-Forwarded-For), "header" (X-Real-IP) or "none" (nothing named anyone).
   */
  source: "peer" | "forwarded" | "header" | "none"
  /**
   * True when forwarded headers arrived from a peer that is not a trusted
   * proxy and were ignored: the app is behind a proxy it was not told about.
   * The app can warn once.
   */
  untrustedForwarded: boolean
}

function forwardedEntries(headers: Headers): string[] {
  return (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function fromForwardedHeaders(
  headers: Headers,
  raw: string | undefined,
  hops: number,
): ClientIp {
  const entries = forwardedEntries(headers)

  if (raw) {
    const list = trustedList(raw)
    if (entries.length === 0) {
      return { ip: "local", source: "none", untrustedForwarded: false }
    }
    let chosen = entries[0] ?? ""
    for (let i = entries.length - 1; i >= 0; i--) {
      const address = unmapped(entries[i] ?? "")
      const type = family(address)
      if (!type || !list.check(address, type)) {
        chosen = entries[i] ?? ""
        break
      }
    }
    return {
      ip: addressKey(unmapped(chosen)),
      source: "forwarded",
      untrustedForwarded: false,
    }
  }

  if (entries.length > 0) {
    const from = Math.max(1, Math.floor(hops))
    const index = Math.max(0, entries.length - from)
    return {
      ip: addressKey(unmapped(entries[index] ?? "")),
      source: "forwarded",
      untrustedForwarded: false,
    }
  }

  const real = headers.get("x-real-ip")?.trim()
  return real
    ? {
        ip: addressKey(unmapped(real)),
        source: "header",
        untrustedForwarded: false,
      }
    : { ip: "local", source: "none", untrustedForwarded: false }
}

/**
 * The client's address, for rate limits, and how it was found.
 *
 * With `trustedProxies` (addresses and CIDR ranges), X-Forwarded-For is read
 * from the right, past every address that is one of them, to the first that
 * is not: each proxy appends the address that connected to it, so whatever a
 * client wrote itself sits to the left and is never reached. When every
 * entry is trusted, the left-most.
 *
 * Without it, the entry `hops` places from the right (1 by default, the
 * address the one proxy in front of the app appended). X-Real-IP counts only
 * when there is no X-Forwarded-For. "local" when no header names anyone.
 *
 * When the connecting address is known (`peer`, or `peerHeader`), forwarded
 * headers count only if it is a proxy: loopback, or inside `trustedProxies`
 * when that is set (loopback is always trusted). From any other peer they are
 * ignored, the peer is the answer, and `untrustedForwarded` says that
 * forwarded headers were there. With no forwarded headers the peer is the
 * answer too. A peer that is not an IP address is hashed, never trusted.
 *
 * The caller must strip an incoming `peerHeader` before its own server sets
 * it; otherwise a client chooses its own address.
 */
export function resolveClientIp(
  headers: Headers,
  {
    trustedProxies,
    hops = 1,
    peer,
    peerHeader,
    forwardedHeader,
  }: ClientIpOptions = {},
): ClientIp {
  const raw = trustedProxies?.trim() || undefined
  const peerValue = (
    peer ?? (peerHeader ? headers.get(peerHeader) : null)
  )?.trim()

  if (!peerValue) return fromForwardedHeaders(headers, raw, hops)

  const address = unmapped(peerValue)
  const type = family(address)
  const proxy = (raw ? trustedList(raw) : trustedList("")).check(
    address,
    type ?? "ipv4",
  )
  const trusted = type !== null && proxy
  const marked = forwardedHeader ? !!headers.get(forwardedHeader) : true
  const forwarded =
    marked &&
    (forwardedEntries(headers).length > 0 || !!headers.get("x-real-ip")?.trim())

  if (trusted && forwarded) return fromForwardedHeaders(headers, raw, hops)

  return {
    ip: addressKey(address),
    source: "peer",
    untrustedForwarded: !trusted && forwarded,
  }
}

/** `resolveClientIp`'s address alone. */
export function clientIpFromHeaders(
  headers: Headers,
  options: ClientIpOptions = {},
): string {
  return resolveClientIp(headers, options).ip
}

/**
 * For the app's own server entry, before its framework handles the request:
 * removes any incoming header of that name (a client could send one) and sets
 * it from the socket, so `resolveClientIp`'s `peerHeader` can be believed.
 * Without a socket address it is stamped "unknown", never left absent: the
 * resolver hashes that into one untrusted key instead of falling back to
 * believing forwarded headers.
 *
 * With `forwardedHeader`, any client copy of that header is removed too, and
 * it is set to "1" only when the client really sent X-Forwarded-For or
 * X-Real-IP. Call this before the framework touches headers, then pass the
 * same name as `ClientIpOptions.forwardedHeader`.
 */
export function stampPeer(
  req: Pick<IncomingMessage, "headers" | "socket">,
  headerName: string,
  { forwardedHeader }: { forwardedHeader?: string } = {},
): void {
  const name = headerName.toLowerCase()
  const marker = forwardedHeader?.toLowerCase()
  const sent = !!(req.headers["x-forwarded-for"] || req.headers["x-real-ip"])
  delete req.headers[name]
  if (marker) {
    delete req.headers[marker]
    if (sent) req.headers[marker] = "1"
  }
  req.headers[name] = req.socket?.remoteAddress || "unknown"
}
