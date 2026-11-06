import http from "node:http"
import type { AddressInfo } from "node:net"

import { describe, expect, it } from "vitest"

import {
  isPublicAddress,
  NotPublicError,
  publicFetch,
  publicLookup,
} from "./net"

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])("allows %s", (a) => {
    expect(isPublicAddress(a)).toBe(true)
  })

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "168.63.129.16",
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "fd00::1",
    "fe80::1%eth0",
    "2001:db8::1",
    "2001::1",
    "2001:4:112::1",
    "2001:1ff::1",
    "not-an-address",
  ])("refuses %s", (a) => {
    expect(isPublicAddress(a)).toBe(false)
  })
})

describe("publicLookup", () => {
  it("refuses, as the socket connects, a name that resolves to loopback", async () => {
    const error = await new Promise<unknown>((resolve) => {
      publicLookup()("localhost", {}, (err) => resolve(err))
    })
    expect(error).toBeInstanceOf(NotPublicError)
  })
})

describe("publicFetch", () => {
  it("refuses a loopback literal and a name that resolves to one", async () => {
    await expect(publicFetch("http://127.0.0.1:65000/")).rejects.toBeInstanceOf(
      NotPublicError,
    )
    await expect(publicFetch("http://localhost:65000/")).rejects.toBeInstanceOf(
      NotPublicError,
    )
  })

  it("refuses credentials and other schemes", async () => {
    await expect(publicFetch("http://a:b@example.com/")).rejects.toThrow(
      /credentials/,
    )
    await expect(publicFetch("file:///etc/passwd")).rejects.toThrow(
      /not fetched/,
    )
  })

  it("connects where the policy allows, and refuses redirects unless asked", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/go") {
        res.writeHead(302, { location: "/here" }).end()
      } else {
        res.end("ok")
      }
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const { port } = server.address() as AddressInfo
    const allow = (a: string) => a === "127.0.0.1"

    try {
      const res = await publicFetch(`http://127.0.0.1:${port}/here`, { allow })
      expect(await res.text()).toBe("ok")
      await expect(
        publicFetch(`http://127.0.0.1:${port}/go`, { allow }),
      ).rejects.toThrow(/redirected/)
      const followed = await publicFetch(`http://127.0.0.1:${port}/go`, {
        allow,
        maxRedirects: 1,
      })
      expect(await followed.text()).toBe("ok")
    } finally {
      server.close()
    }
  })
})
