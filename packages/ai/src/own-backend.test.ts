import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "vitest"

import { BackendRefusedError } from "./refusal"
import { createOwnBackend, guardedFetch, resolveByOrder } from "./own-backend"

describe("createOwnBackend", () => {
  const base = {
    baseUrl: "https://api.example.com/v1/",
    allowPrivate: false,
    openKey: (s: string) => s.replace("sealed:", ""),
  }

  it("opens the key and guards the fetch", async () => {
    const backend = await createOwnBackend({ ...base, sealedKey: "sealed:abc" })
    expect(backend).toMatchObject({
      source: "own",
      baseURL: "https://api.example.com/v1",
      apiKey: "abc",
      provider: "openai-compatible",
      toolChoice: "auto",
      providerName: "own-model",
    })
    expect(typeof backend.fetch).toBe("function")
  })

  it("needs no key for an endpoint that wants none", async () => {
    expect((await createOwnBackend(base)).apiKey).toBeUndefined()
  })

  it("refuses an address it may not call, without fallback", async () => {
    const error = await createOwnBackend({
      ...base,
      baseUrl: "http://localhost:1",
    }).catch((e) => e)
    expect(error).toBeInstanceOf(BackendRefusedError)
    expect(error).toMatchObject({
      reason: "unreachable",
      fallbackWorthy: false,
    })
  })

  it("refuses a key that will not open, naming no key", async () => {
    const error = await createOwnBackend({
      ...base,
      sealedKey: "v2:secret-text",
      openKey: () => {
        throw new Error("bad tag v2:secret-text")
      },
    }).catch((e) => e)
    expect(error).toMatchObject({ reason: "unreadable" })
    expect(error.message).not.toContain("secret-text")
  })
})

describe("guardedFetch", () => {
  it("refuses an address the shape check rules out", async () => {
    await expect(guardedFetch(false)("http://example.com/x")).rejects.toThrow(
      /was not called/,
    )
  })

  it("refuses a name that resolves to a private address", async () => {
    await expect(guardedFetch(false)("https://localhost/x")).rejects.toThrow(
      /private network|was not called/,
    )
  })

  it("reaches a local server when private addresses are allowed, and refuses a redirect", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "/ok" }).end()
        return
      }
      res.end("hello")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const { port } = server.address() as AddressInfo
    try {
      const fetcher = guardedFetch(true)
      expect(await (await fetcher(`http://127.0.0.1:${port}/ok`)).text()).toBe(
        "hello",
      )
      await expect(
        fetcher(`http://127.0.0.1:${port}/redirect`),
      ).rejects.toThrow()
    } finally {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  })
})

describe("resolveByOrder", () => {
  const backend = {
    source: "deployment",
    baseURL: "h",
    toolChoice: "required" as const,
  }
  it("returns the chosen back end", async () => {
    const chosen = await resolveByOrder("deployment_only", () => ({
      ok: true,
      value: backend,
    }))
    expect(chosen.value).toBe(backend)
    expect(chosen.source).toBe("deployment")
  })
  it("throws the final refusal, fallback-worthy only for an unlisted or unpriced model", async () => {
    const refuse =
      (reason: "out" | "unlisted") => (source: "deployment" | "own") => ({
        ok: false as const,
        refusal: {
          source,
          reason,
          message: `${source} ${reason}`,
          until: undefined,
        },
      })
    const out = await resolveByOrder(
      "own_then_deployment",
      refuse("out"),
    ).catch((e) => e)
    expect(out).toMatchObject({
      message: "deployment out",
      reason: "out",
      fallbackWorthy: false,
    })
    const unlisted = await resolveByOrder(
      "deployment_only",
      refuse("unlisted"),
    ).catch((e) => e)
    expect(unlisted.fallbackWorthy).toBe(true)
  })
})
