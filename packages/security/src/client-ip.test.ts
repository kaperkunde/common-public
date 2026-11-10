import { describe, expect, it } from "vitest"

import { clientIpFromHeaders, resolveClientIp, stampPeer } from "./client-ip"

const h = (xff?: string, extra: Record<string, string> = {}) =>
  new Headers({ ...(xff ? { "x-forwarded-for": xff } : {}), ...extra })

describe("resolveClientIp without a peer", () => {
  it("behaves as before and reports the source", () => {
    expect(resolveClientIp(h("6.6.6.6, 1.2.3.4"))).toEqual({
      ip: "1.2.3.4",
      source: "forwarded",
      untrustedForwarded: false,
    })
    expect(
      resolveClientIp(h(undefined, { "x-real-ip": "1.2.3.4" })).source,
    ).toBe("header")
    expect(resolveClientIp(new Headers())).toEqual({
      ip: "local",
      source: "none",
      untrustedForwarded: false,
    })
    expect(
      clientIpFromHeaders(h("6.6.6.6, 1.2.3.4, 10.0.0.1"), {
        trustedProxies: "10.0.0.0/8",
      }),
    ).toBe("1.2.3.4")
  })
})

describe("resolveClientIp with a peer", () => {
  it("counts forwarded headers from a loopback peer", () => {
    const r = resolveClientIp(h("6.6.6.6, 1.2.3.4"), { peer: "127.0.0.1" })
    expect(r).toEqual({
      ip: "1.2.3.4",
      source: "forwarded",
      untrustedForwarded: false,
    })
    expect(resolveClientIp(h("1.2.3.4"), { peer: "::1" }).ip).toBe("1.2.3.4")
  })

  it("answers the peer from a non-loopback peer and flags the headers", () => {
    const r = resolveClientIp(h("9.9.9.9"), { peer: "203.0.113.5" })
    expect(r).toEqual({
      ip: "203.0.113.5",
      source: "peer",
      untrustedForwarded: true,
    })
    expect(
      resolveClientIp(h(undefined, { "x-real-ip": "9.9.9.9" }), {
        peer: "10.1.1.1",
      }).untrustedForwarded,
    ).toBe(true)
  })

  it("answers the peer without a flag when nothing was forwarded", () => {
    expect(resolveClientIp(h(), { peer: "203.0.113.5" })).toEqual({
      ip: "203.0.113.5",
      source: "peer",
      untrustedForwarded: false,
    })
    expect(resolveClientIp(h(), { peer: "127.0.0.1" }).ip).toBe("127.0.0.1")
  })

  it("trusts a peer inside the trusted proxies and keeps the right-most rule", () => {
    const opts = { trustedProxies: "10.0.0.0/8", peer: "10.2.3.4" }
    const r = resolveClientIp(h("6.6.6.6, 1.2.3.4, 10.0.0.1"), opts)
    expect(r).toEqual({
      ip: "1.2.3.4",
      source: "forwarded",
      untrustedForwarded: false,
    })
  })

  it("answers the peer when it is outside the trusted proxies", () => {
    const r = resolveClientIp(h("1.2.3.4"), {
      trustedProxies: "10.0.0.0/8",
      peer: "203.0.113.5",
    })
    expect(r).toEqual({
      ip: "203.0.113.5",
      source: "peer",
      untrustedForwarded: true,
    })
  })

  it("keeps loopback trusted when trusted proxies are set", () => {
    expect(
      resolveClientIp(h("1.2.3.4"), {
        trustedProxies: "10.0.0.0/8",
        peer: "127.0.0.1",
      }).ip,
    ).toBe("1.2.3.4")
  })

  it("handles IPv6 and IPv4-mapped peers", () => {
    expect(resolveClientIp(h("1.2.3.4"), { peer: "::ffff:127.0.0.1" }).ip).toBe(
      "1.2.3.4",
    )
    expect(
      resolveClientIp(h("9.9.9.9"), { peer: "::ffff:203.0.113.5" }).ip,
    ).toBe("203.0.113.5")
    expect(
      resolveClientIp(h("9.9.9.9"), { peer: "2001:db8::1" }),
    ).toMatchObject({
      ip: "2001:db8::1",
      untrustedForwarded: true,
    })
    expect(
      resolveClientIp(h("1.2.3.4"), {
        trustedProxies: "fd00::/8",
        peer: "fd00::5",
      }).ip,
    ).toBe("1.2.3.4")
  })

  it("never trusts a peer that is not an address", () => {
    const r = resolveClientIp(h("1.2.3.4"), { peer: "garbage" })
    expect(r.ip).toMatch(/^h:[0-9a-f]{32}$/)
    expect(r.untrustedForwarded).toBe(true)
  })

  it("reads the peer from the stamped header", () => {
    const headers = h("9.9.9.9", { "x-peer": "203.0.113.5" })
    expect(resolveClientIp(headers, { peerHeader: "x-peer" }).ip).toBe(
      "203.0.113.5",
    )
    expect(clientIpFromHeaders(headers, { peerHeader: "x-peer" })).toBe(
      "203.0.113.5",
    )
  })
})

describe("stampPeer", () => {
  it("replaces a spoofed header with the socket address", () => {
    const req = {
      headers: { "x-peer": "1.1.1.1", "x-forwarded-for": "2.2.2.2" },
      socket: { remoteAddress: "203.0.113.5" },
    } as never
    stampPeer(req, "X-Peer")
    expect((req as { headers: Record<string, string> }).headers["x-peer"]).toBe(
      "203.0.113.5",
    )
  })

  it("stamps unknown without a socket address, which resolves untrusted", () => {
    const req = {
      headers: { "x-peer": "1.1.1.1" },
      socket: {},
    } as unknown as Parameters<typeof stampPeer>[0]
    stampPeer(req, "x-peer")
    expect(req.headers["x-peer"]).toBe("unknown")

    const r = resolveClientIp(h("6.6.6.6", { "x-peer": "unknown" }), {
      peerHeader: "x-peer",
    })
    expect(r.source).toBe("peer")
    expect(r.ip).toMatch(/^h:[0-9a-f]{32}$/)
    expect(r.untrustedForwarded).toBe(true)
  })

  it("strips a spoofed marker and sets it only when forwarded headers were sent", () => {
    const spoofed = {
      headers: { "x-fwd": "1" },
      socket: { remoteAddress: "203.0.113.5" },
    } as unknown as Parameters<typeof stampPeer>[0]
    stampPeer(spoofed, "x-peer", { forwardedHeader: "X-Fwd" })
    expect(spoofed.headers["x-fwd"]).toBeUndefined()

    for (const sent of [
      { "x-forwarded-for": "1.2.3.4" },
      { "x-real-ip": "1.2.3.4" },
    ]) {
      const req = {
        headers: { ...sent },
        socket: { remoteAddress: "203.0.113.5" },
      } as unknown as Parameters<typeof stampPeer>[0]
      stampPeer(req, "x-peer", { forwardedHeader: "x-fwd" })
      expect(req.headers["x-fwd"]).toBe("1")
    }
  })
})

describe("resolveClientIp with a forwardedHeader marker", () => {
  const opts = { peerHeader: "x-peer", forwardedHeader: "x-fwd" }

  it("ignores the framework's own X-Forwarded-For fill (no marker)", () => {
    const r = resolveClientIp(
      h("192.168.1.5", { "x-peer": "192.168.1.5" }),
      opts,
    )
    expect(r).toEqual({
      ip: "192.168.1.5",
      source: "peer",
      untrustedForwarded: false,
    })
  })

  it("flags forwarded headers the client really sent from an untrusted peer", () => {
    const r = resolveClientIp(
      h("6.6.6.6", { "x-peer": "192.168.1.5", "x-fwd": "1" }),
      opts,
    )
    expect(r).toEqual({
      ip: "192.168.1.5",
      source: "peer",
      untrustedForwarded: true,
    })
  })

  it("still reads forwarded headers from a trusted peer with the marker", () => {
    const r = resolveClientIp(
      h("6.6.6.6", { "x-peer": "127.0.0.1", "x-fwd": "1" }),
      opts,
    )
    expect(r.ip).toBe("6.6.6.6")
    expect(r.source).toBe("forwarded")
  })

  it("changes nothing without a known peer", () => {
    expect(resolveClientIp(h("1.2.3.4"), { forwardedHeader: "x-fwd" }).ip).toBe(
      "1.2.3.4",
    )
  })
})
