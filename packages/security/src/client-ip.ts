import { createHash } from "node:crypto"
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

/**
 * The client's address, for rate limits, from a request's headers.
 *
 * With `trustedProxies` (addresses and CIDR ranges), X-Forwarded-For is read
 * from the right, past every address that is one of them, to the first that
 * is not: each proxy appends the address that connected to it, so whatever a
 * client wrote itself sits to the left and is never reached. When every
 * entry is trusted, the left-most.
 *
 * Without it, the entry `hops` places from the right (1 by default, the
 * address the one proxy in front of the app appended): whatever a client
 * wrote itself sits further left and is never reached. Behind a proxy that
 * replaces the header instead, that is the only entry, so the default fits
 * both. X-Real-IP counts only when there is no X-Forwarded-For. Answers
 * "local" when no header names anyone.
 */
export function clientIpFromHeaders(
  headers: Headers,
  { trustedProxies, hops = 1 }: { trustedProxies?: string; hops?: number } = {},
): string {
  const raw = trustedProxies?.trim()

  if (raw) {
    const list = trustedList(raw)
    const entries = (headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)

    if (entries.length === 0) return "local"

    for (let i = entries.length - 1; i >= 0; i--) {
      const address = unmapped(entries[i] ?? "")
      const type = family(address)
      if (!type || !list.check(address, type)) return addressKey(address)
    }

    return addressKey(unmapped(entries[0] ?? ""))
  }

  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (entries.length > 0) {
    const from = Math.max(1, Math.floor(hops))
    const index = Math.max(0, entries.length - from)
    return addressKey(unmapped(entries[index] ?? ""))
  }

  const real = headers.get("x-real-ip")?.trim()
  return real ? addressKey(unmapped(real)) : "local"
}
