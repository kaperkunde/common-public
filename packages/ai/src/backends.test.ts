import { describe, expect, it } from "vitest"

import {
  BACKEND_ORDERS,
  DEFAULT_ORDER,
  aiAvailability,
  backendSequence,
  calendarMonthUtc,
  chooseBackend,
  fallbackOfOrder,
  finalRefusal,
  hostedOffers,
  isBackendOrder,
  modelForPlayer,
  modelOnSource,
  normalBaseUrl,
  orderFor,
  outOfCredit,
  ownBackendUsable,
  ownEndpointShape,
  ownVerdict,
  pickableModels,
  pickedModel,
  sourceOfOrder,
  type Refusal,
} from "./backends"

const config = { enabled: true, models: ["h1", "h2"], defaultModel: "h1" }

describe("orders", () => {
  it("walks the order, and a person with none has the hosted back end", () => {
    expect(backendSequence("own_then_hosted")).toEqual(["own", "hosted"])
    expect(backendSequence("hosted_then_own")).toEqual(["hosted", "own"])
    expect(backendSequence("own_only")).toEqual(["own"])
    expect(backendSequence("hosted_only")).toEqual(["hosted"])
    expect(backendSequence(null)).toEqual(["hosted"])
  })
  it("round-trips through orderFor", () => {
    for (const order of BACKEND_ORDERS) {
      expect(orderFor(sourceOfOrder(order), fallbackOfOrder(order))).toBe(order)
    }
    expect(isBackendOrder(DEFAULT_ORDER)).toBe(true)
    expect(isBackendOrder("lore_only")).toBe(false)
  })
})

describe("chooseBackend", () => {
  const refusal = (
    source: "hosted" | "own",
    reason: Refusal["reason"],
  ): Refusal => ({
    source,
    reason,
    message: `${source} ${reason}`,
  })
  it("takes the first that can serve and asks no more", async () => {
    const asked: string[] = []
    const chosen = await chooseBackend("own_then_hosted", (source) => {
      asked.push(source)
      return { ok: true, value: source }
    })
    expect(chosen).toMatchObject({ ok: true, source: "own", passedOver: [] })
    expect(asked).toEqual(["own"])
  })
  it("falls to the next and remembers what it passed over", async () => {
    const chosen = await chooseBackend("own_then_hosted", async (source) =>
      source === "own"
        ? { ok: false, refusal: refusal("own", "over_limit") }
        : { ok: true, value: 1 },
    )
    expect(chosen).toMatchObject({ ok: true, source: "hosted" })
    expect(chosen.ok && chosen.passedOver).toHaveLength(1)
  })
  it("reports every refusal when nothing can serve", async () => {
    const chosen = await chooseBackend("own_then_hosted", (source) => ({
      ok: false,
      refusal: refusal(source, "off"),
    }))
    expect(chosen.ok).toBe(false)
    expect(!chosen.ok && chosen.refusals).toHaveLength(2)
  })

  it("answers with credit run out first, then the soonest date, then the first", () => {
    const out = refusal("hosted", "out")
    expect(outOfCredit(out)).toBe(true)
    expect(finalRefusal([refusal("own", "off"), out])).toBe(out)
    const late = { ...refusal("own", "over_limit"), until: "2026-12-01" }
    const soon = { ...refusal("hosted", "unlisted"), until: "2026-11-20" }
    expect(finalRefusal([late, soon])).toBe(soon)
    const first = refusal("own", "off")
    expect(finalRefusal([first, refusal("hosted", "unlisted")])).toBe(first)
    expect(finalRefusal([])).toBeUndefined()
  })
})

describe("verdicts", () => {
  it("refuses an own back end that is missing, lacks the model or is over its limit", () => {
    const own = { baseUrl: "https://x", models: ["m"], llmTokenLimit: 100 }
    expect(ownVerdict(undefined, "m", { spent: 0 })).toMatchObject({
      ok: false,
      refusal: { reason: "unconfigured" },
    })
    expect(ownVerdict(own, "other", { spent: 0 })).toMatchObject({
      ok: false,
      refusal: { reason: "unlisted" },
    })
    const over = ownVerdict(own, "m", {
      spent: 100,
      period: { start: "a", end: "2026-12-01T00:00:00.000Z" },
    })
    expect(over).toMatchObject({
      ok: false,
      refusal: { reason: "over_limit", until: "2026-12-01T00:00:00.000Z" },
    })
    expect(!over.ok && over.refusal.message).toContain("2026-12-01")
    expect(ownVerdict(own, "m", { spent: 99 })).toEqual({
      ok: true,
      value: true,
    })
    expect(
      ownVerdict({ ...own, llmTokenLimit: null }, "m", { spent: 1e9 }).ok,
    ).toBe(true)
  })
  it("words the limit as the app likes", () => {
    const own = { baseUrl: "https://x", models: ["m"], llmTokenLimit: 1 }
    const v = ownVerdict(own, "m", { spent: 5 }, { limit: (n) => `limit ${n}` })
    expect(!v.ok && v.refusal.message).toBe("limit 1")
  })
  it("says whether the hosted model can be asked for at all", () => {
    expect(hostedOffers({ enabled: false, models: [] }, "m")).toMatchObject({
      ok: false,
      refusal: { reason: "off" },
    })
    expect(hostedOffers(config, "zzz")).toMatchObject({
      ok: false,
      refusal: { reason: "unlisted" },
    })
    expect(hostedOffers(config, "h2").ok).toBe(true)
  })
})

describe("model choice", () => {
  const own = { models: ["o1"], order: "own_then_hosted" as const }
  it("falls to what a back end offers", () => {
    expect(modelOnSource("a", ["a", "b"])).toBe("a")
    expect(modelOnSource("z", ["a", "b"], "b")).toBe("b")
    expect(modelOnSource("z", ["a", "b"], "q")).toBe("a")
    expect(modelOnSource("z", [])).toBeUndefined()
  })
  it("keeps a chosen model a back end still offers, else the first of the first back end", () => {
    expect(modelForPlayer("h2", config, own)).toBe("h2")
    expect(modelForPlayer("gone", config, own)).toBe("o1")
    expect(modelForPlayer(null, config)).toBe("h1")
    expect(modelForPlayer("o1", config)).toBe("h1")
    expect(modelForPlayer(null, { models: [], defaultModel: "d" })).toBe("d")
  })
  it("says which back end the picked model is on", () => {
    expect(pickedModel("o1", config, own)).toEqual({
      model: "o1",
      source: "own",
    })
    expect(pickedModel("h1", config, own)).toEqual({
      model: "h1",
      source: "hosted",
    })
  })
  it("lists every model with its back ends and the ones the order leaves out", () => {
    const list = pickableModels(["h1"], {
      models: ["o1", "h1"],
      order: "own_only",
    })
    expect(list).toEqual([
      { model: "h1", sources: ["own"], offeredElsewhere: ["hosted"] },
      { model: "o1", sources: ["own"], offeredElsewhere: [] },
    ])
  })
})

describe("addresses", () => {
  it("trims a base url", () => {
    expect(normalBaseUrl(" https://a.b/v1// ")).toBe("https://a.b/v1")
  })
  it.each([
    ["not a url", "that is not a web address"],
    ["ftp://a.b", "https://"],
    ["https://u:p@a.b", "key field"],
    ["https://a.b/v1?x=1", "no ? or #"],
    ["http://a.b", "in the clear"],
    ["https://localhost", "private"],
    ["https://127.0.0.1", "private"],
    ["https://10.1.2.3", "private"],
    ["https://192.168.0.5", "private"],
    ["https://172.20.0.1", "private"],
    ["https://169.254.169.254", "private"],
    ["https://[::1]", "private"],
    ["https://box.internal", "private"],
    ["https://intranet", "private"],
  ])("refuses %s", (url, reason) => {
    const verdict = ownEndpointShape(url, false)
    expect(verdict.ok).toBe(false)
    expect(!verdict.ok && verdict.reason).toContain(reason)
  })
  it("accepts a public https address, and anything http(s) when private is allowed", () => {
    expect(ownEndpointShape("https://api.example.com/v1/", false).ok).toBe(true)
    expect(ownEndpointShape("http://localhost:11434/v1", true).ok).toBe(true)
    expect(ownEndpointShape("ftp://x", true).ok).toBe(false)
  })
})

describe("availability", () => {
  const own = {
    baseUrl: "https://api.example.com/v1",
    models: ["m"],
    order: "own_then_hosted" as const,
  }
  it("counts a usable own back end, and either alone is an AI", () => {
    expect(ownBackendUsable(own, false)).toBe(true)
    expect(ownBackendUsable({ ...own, order: "hosted_only" }, false)).toBe(
      false,
    )
    expect(ownBackendUsable({ ...own, models: [] }, false)).toBe(false)
    expect(
      ownBackendUsable({ ...own, baseUrl: "http://localhost" }, false),
    ).toBe(false)
    expect(ownBackendUsable(null, false)).toBe(false)
    expect(
      aiAvailability({
        deployment: { enabled: false },
        own,
        allowPrivate: false,
      }),
    ).toEqual({
      available: true,
      deployment: false,
      own: true,
    })
    expect(
      aiAvailability({ deployment: { enabled: false }, allowPrivate: false })
        .available,
    ).toBe(false)
    expect(
      aiAvailability({ deployment: { enabled: true }, allowPrivate: false })
        .available,
    ).toBe(true)
  })
})

describe("calendarMonthUtc", () => {
  it("is the month in UTC, end exclusive", () => {
    expect(calendarMonthUtc(new Date("2026-11-30T23:59:59Z"))).toEqual({
      start: "2026-11-01T00:00:00.000Z",
      end: "2026-12-01T00:00:00.000Z",
    })
    expect(calendarMonthUtc(new Date("2026-12-15T00:00:00Z")).end).toBe(
      "2027-01-01T00:00:00.000Z",
    )
  })
})
