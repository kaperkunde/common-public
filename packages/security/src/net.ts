import dns, { type LookupAddress } from "node:dns"
import { BlockList, isIP, type LookupFunction } from "node:net"

import { Agent, Headers, fetch as undiciFetch, type RequestInit } from "undici"

/**
 * Which addresses count as public, and connections that only reach those.
 *
 * Loopback, private, link-local (where a cloud host's metadata lives),
 * carrier-grade NAT, multicast, documentation and benchmarking ranges are
 * refused, and so are the IPv6 forms that wrap an IPv4 address (mapped,
 * compatible, NAT64, 6to4, Teredo), because each reaches something on the
 * host's own network. BlockList compares an IPv4-mapped IPv6 address against
 * the IPv4 rules, so the mapped form of a blocked address is blocked too.
 *
 * Checking a name and then fetching it resolves the name twice, and a name
 * anybody controls can answer with a public address for the check and a
 * private one for the connection (DNS rebinding). So the check rides on the
 * socket: `publicLookup` refuses a name unless every address it resolves to
 * is public, and `publicFetch` connects only through it.
 */

const V4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["168.63.129.16", 32], // Azure's virtual host address
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and broadcast
]

const V6: Array<[string, number]> = [
  ["::", 96], // unspecified, loopback, IPv4-compatible
  ["::ffff:0:0:0", 96], // SIIT
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard-only
  ["2001::", 23], // IETF protocol assignments, Teredo among them
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
]

const blocked = new BlockList()
for (const [network, prefix] of V4) blocked.addSubnet(network, prefix, "ipv4")
for (const [network, prefix] of V6) blocked.addSubnet(network, prefix, "ipv6")

/** True for a public IP address; false for anything else, malformed included. */
export function isPublicAddress(address: string): boolean {
  const bare = address.replace(/%.*$/, "").replace(/^\[|\]$/g, "")
  const family = isIP(bare)
  if (family === 0) return false
  return !blocked.check(bare, family === 4 ? "ipv4" : "ipv6")
}

/** Why a connection was refused: the host, never what it resolved to. */
export class NotPublicError extends Error {
  constructor(readonly host: string) {
    super(`${host} is, or resolves to, a private or local address.`)
    this.name = "NotPublicError"
  }
}

export type AddressPolicy = {
  /**
   * Whether an address may be connected to, beyond being public. The app's
   * own extra refusals go here (PCP refuses its own ports even where private
   * addresses are allowed). Defaults to isPublicAddress.
   */
  allow?: (address: string) => boolean
}

/** A socket lookup that refuses a name unless every address it has is allowed. */
export function publicLookup({
  allow = isPublicAddress,
}: AddressPolicy = {}): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error, "", 0)
        return
      }
      const list = addresses as LookupAddress[]
      if (list.length === 0 || !list.every((a) => allow(a.address))) {
        callback(new NotPublicError(hostname), "", 0)
        return
      }
      if (options.all) callback(null, list)
      else callback(null, list[0]!.address, list[0]!.family)
    })
  }
}

export type PublicFetchOptions = RequestInit &
  AddressPolicy & {
    /** Redirects followed by hand, each checked like the first. Default 0: a redirect is an error. */
    maxRedirects?: number
    /** Defaults to 15 seconds. */
    timeoutMs?: number
  }

const agents = new WeakMap<object, Agent>()
const defaultPolicy = {}

function agentFor(allow: AddressPolicy["allow"]): Agent {
  const key = allow ?? defaultPolicy
  let agent = agents.get(key)
  if (!agent) {
    agent = new Agent({ connect: { lookup: publicLookup({ allow }) } })
    agents.set(key, agent)
  }
  return agent
}

/**
 * fetch, connecting only to allowed (by default public) addresses: http and
 * https only, no credentials in the URL, an IP literal checked before
 * connecting (it never reaches a lookup), every name checked as the socket
 * connects, and redirects either refused or followed by hand and checked
 * again. Throws NotPublicError for an address it will not reach.
 */
export async function publicFetch(
  input: string | URL,
  {
    allow,
    maxRedirects = 0,
    timeoutMs = 15_000,
    ...init
  }: PublicFetchOptions = {},
): Promise<Response> {
  const dispatcher = agentFor(allow)
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs)
  let url = new URL(input)
  let method = (init.method ?? "GET").toUpperCase()
  let body = init.body
  const headers = new Headers(init.headers)

  for (let hop = 0; ; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new TypeError(`${url.protocol} is not fetched`)
    }
    if (url.username || url.password) {
      throw new TypeError("a URL with credentials in it is not fetched")
    }

    const host = url.hostname.replace(/^\[|\]$/g, "")
    if (isIP(host) && !(allow ?? isPublicAddress)(host)) {
      throw new NotPublicError(url.hostname)
    }

    let response
    try {
      response = await undiciFetch(url, {
        ...init,
        method,
        body,
        headers,
        redirect: "manual",
        signal,
        dispatcher,
      })
    } catch (error) {
      // undici wraps what the lookup refused; find it in the cause chain.
      for (
        let cause: unknown = error;
        cause;
        cause = (cause as { cause?: unknown }).cause
      ) {
        if (cause instanceof NotPublicError) throw cause
        if ((cause as Error).name === "NotPublicError") {
          throw new NotPublicError(url.hostname)
        }
      }
      throw error
    }

    const location = response.headers.get("location")
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel()
      if (hop >= maxRedirects) {
        throw new TypeError(
          `${url.host} redirected, and redirects are not followed here`,
        )
      }
      const next = new URL(location, url)
      // As a browser does: a 303, or a 301/302 after a POST, becomes a GET
      // with no body; and credentials never follow a redirect to another
      // origin, whose server the caller never chose to trust with them.
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          method === "POST")
      ) {
        if (method !== "HEAD") method = "GET"
        body = undefined
        for (const name of [
          "content-type",
          "content-length",
          "content-encoding",
          "content-language",
          "content-location",
        ]) {
          headers.delete(name)
        }
      }
      if (next.origin !== url.origin) {
        for (const name of ["authorization", "cookie", "proxy-authorization"]) {
          headers.delete(name)
        }
      }
      url = next
      continue
    }

    return response as unknown as Response
  }
}
