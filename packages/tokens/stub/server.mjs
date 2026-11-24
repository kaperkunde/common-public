// Token Center contract stub (contract v1). Plain Node >= 22, no dependencies.
// In-memory wallet; canned or forwarded provider answers; signed webhooks. Not the center.
// `startStub(options)` starts one; `tokens-stub` (cli.mjs) is the command line. Kept in sync with
// the contract (types.ts / openapi.yaml): see the package README, "Testing against the stub".
import { createServer } from "node:http"
import { createHmac, randomBytes } from "node:crypto"

/**
 * Start a stand-in Token Center. Options map onto the `TOKENS_STUB_*` environment variables
 * (an option wins over its variable): port (0 = any free port), key, webhookUrl, webhookSecret,
 * upstream {anthropic, openai, own}, extraModels, startMicros, feeBps, unitOne, unitMany, reply.
 * Resolves to {url, port, close(), reset()}.
 */
export function startStub(options = {}) {
  const set = (name, value) =>
    value === undefined || value === null
      ? {}
      : { [name]: Array.isArray(value) ? value.join(",") : String(value) }
  const env = {
    ...process.env,
    ...set("TOKENS_STUB_PORT", options.port),
    ...set("TOKENS_STUB_KEY", options.key),
    ...set("TOKENS_STUB_WEBHOOK_URL", options.webhookUrl),
    ...set("TOKENS_STUB_WEBHOOK_SECRET", options.webhookSecret),
    ...set("TOKENS_STUB_ANTHROPIC_UPSTREAM", options.upstream?.anthropic),
    ...set("TOKENS_STUB_OPENAI_UPSTREAM", options.upstream?.openai),
    ...set("TOKENS_STUB_OWN_UPSTREAM", options.upstream?.own),
    ...set("TOKENS_STUB_EXTRA_MODELS", options.extraModels),
    ...set("TOKENS_STUB_START_MICROS", options.startMicros),
    ...set("TOKENS_STUB_FEE_BPS", options.feeBps),
    ...set("TOKENS_STUB_UNIT_ONE", options.unitOne),
    ...set("TOKENS_STUB_UNIT_MANY", options.unitMany),
    ...set("TOKENS_STUB_REPLY", options.reply),
    ...set("TOKENS_STUB_PACKS", options.packsCents),
    ...set("TOKENS_STUB_PACKS_ONLY", options.packsOnly),
    ...set("TOKENS_STUB_FAIL", options.fail),
  }
  const timers = new Set()
  let PORT = Number(env.TOKENS_STUB_PORT ?? 4100)
  const KEY = env.TOKENS_STUB_KEY || null // unset: any non-empty key is accepted
  const HOOK_URL = env.TOKENS_STUB_WEBHOOK_URL || null
  const HOOK_SECRET = env.TOKENS_STUB_WEBHOOK_SECRET ?? "whsec_stub"
  const UP = {
    anthropic: env.TOKENS_STUB_ANTHROPIC_UPSTREAM,
    openai: env.TOKENS_STUB_OPENAI_UPSTREAM,
  }
  const START = Number(env.TOKENS_STUB_START_MICROS ?? 5_000_000)
  const FEE_BPS = Number(env.TOKENS_STUB_FEE_BPS ?? 2000)
  const UNIT = {
    one: env.TOKENS_STUB_UNIT_ONE ?? "token",
    many: env.TOKENS_STUB_UNIT_MANY ?? "tokens",
    perDollar: 1_000_000,
  }
  const PRICE = {
    inputUsdPerM: "3",
    outputUsdPerM: "15",
    cacheReadUsdPerM: "0.3",
    cacheWriteUsdPerM: "3.75",
    cacheWrite1hUsdPerM: "6",
    longPromptTokens: null,
    longPromptFactor: null,
    fastFactor: null,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
  }
  const MODELS = [
    {
      id: "claude-sonnet-5-5",
      displayName: "Claude Sonnet 5.5",
      provider: "anthropic",
      protocol: "anthropic",
    },
    {
      id: "claude-haiku-5-5",
      displayName: "Claude Haiku 5.5",
      provider: "anthropic",
      protocol: "anthropic",
    },
    {
      id: "gpt-5.5-mini",
      displayName: "GPT-5.5 mini",
      provider: "openai",
      protocol: "openai",
    },
    ...(env.TOKENS_STUB_EXTRA_MODELS ?? "")
      .split(",")
      .filter(Boolean)
      .map((id) => ({
        id,
        displayName: id,
        provider: "openai",
        protocol: "openai",
      })),
  ].map((m) => ({
    ...m,
    capabilities: ["tools", "streaming", "json"],
    contextTokens: 200000,
    price: PRICE,
  }))
  const VOICES = [
    {
      id: "stub-voice",
      name: "Stub voice",
      provider: "openai",
      usdPerMChars: "15",
      isDefault: true,
    },
    {
      id: "stub-voice-eleven",
      name: "Stub voice (ElevenLabs)",
      provider: "elevenlabs",
      usdPerMChars: "30",
      isDefault: false,
    },
  ]
  const SALE = [
    {
      currency: "eur",
      centsPerDollar: 121,
      taxBehavior: "inclusive",
      minimumCents: 500,
      effectiveFrom: PRICE.effectiveFrom,
    },
    {
      currency: "usd",
      centsPerDollar: 100,
      taxBehavior: "exclusive",
      minimumCents: 500,
      effectiveFrom: PRICE.effectiveFrom,
    },
  ]
  // Purchase options (contract PurchaseOptions): TOKENS_STUB_PACKS (cents, comma-separated, default
  // AJ's 500,1000,2500,5000) and TOKENS_STUB_PACKS_ONLY=true to allow only those.
  const OPTIONS = {
    packsCents: (env.TOKENS_STUB_PACKS ?? "500,1000,2500,5000")
      .split(",")
      .filter(Boolean)
      .map(Number),
    packsOnly: env.TOKENS_STUB_PACKS_ONLY === "true",
    minimumCents: 500,
    maximumCents: 100000,
  }
  const STATUS = {
    unauthenticated: 401,
    forbidden: 403,
    invalid_request: 400,
    unknown_user: 404,
    not_found: 404,
    unknown_model: 404,
    model_not_priced: 409,
    wrong_protocol: 400,
    insufficient_balance: 402,
    capability_unavailable: 402,
    byo_not_configured: 409,
    byo_failed: 502,
    byo_limit_reached: 402,
    provider_error: 502,
    provider_timeout: 504,
    provider_out_of_credit: 503,
    provider_rate_limited: 429,
    provider_overloaded: 503,
    rate_limited: 429,
    payments_unavailable: 503,
    purchase_too_small: 400,
    refund_not_available: 409,
    refund_amount_invalid: 400,
    refund_refused_by_processor: 409,
    no_card: 409,
    conflict: 409,
    center_unavailable: 503,
    internal_error: 500,
  }

  // A provider failure the test asked for: TOKENS_STUB_FAIL, POST /stub/mode {"fail"} or the request
  // header `x-stub-fail`: out_of_credit, rate_limited or overloaded (see the README).
  const FAIL_FROM_ENV = [
    "out_of_credit",
    "rate_limited",
    "overloaded",
  ].includes(env.TOKENS_STUB_FAIL)
    ? env.TOKENS_STUB_FAIL
    : null
  const FAILS = {
    out_of_credit: "provider_out_of_credit",
    rate_limited: "provider_rate_limited",
    overloaded: "provider_overloaded",
  }
  const PROVIDER_NAME = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    elevenlabs: "ElevenLabs",
  }

  let state
  const reset = () => {
    state = {
      users: new Map(),
      calls: [],
      purchases: new Map(),
      refunds: new Map(),
      mode: {
        down: false,
        providerError: false,
        fail: FAIL_FROM_ENV,
      },
    }
  }
  reset()
  const now = () => new Date().toISOString()
  const id = (p) => `${p}_${randomBytes(12).toString("hex")}`

  // ------------------------------------------------------------------ wallet
  const user = (userId, email) => {
    let u = state.users.get(userId)
    if (!u) {
      u = {
        userId,
        email: null,
        displayName: null,
        createdAt: now(),
        lastSeenAt: null,
        purchased: START,
        lots: [],
        own: null,
        order: "tokens_only",
        autoRefill: {
          enabled: false,
          thresholdMicros: 1_000_000,
          amountCents: 1000,
          currency: "eur",
          monthlyMaxCents: 5000,
          card: null,
          pending: false,
          failedAt: null,
        },
        history: [],
        low: false,
        empty: false,
      }
      state.users.set(userId, u)
    }
    if (email) u.email = email
    u.lastSeenAt = now()
    return u
  }
  const live = (lot) =>
    lot.remainingMicros > 0 && (!lot.expiresAt || lot.expiresAt > now())
  // Every lot is locked to one provider; soonest expiry first, none last, then by id.
  const lotsFor = (u, provider) =>
    u.lots
      .filter((l) => live(l) && l.provider === provider)
      .sort(
        (a, b) =>
          (a.expiresAt ?? "9").localeCompare(b.expiresAt ?? "9") ||
          a.id.localeCompare(b.id),
      )
  const grantsOf = (u) =>
    u.lots.filter(live).reduce((s, l) => s + l.remainingMicros, 0)
  const summary = (u) => ({
    availableMicros: u.purchased + grantsOf(u),
    purchasedMicros: u.purchased,
    grantsMicros: grantsOf(u),
  })
  const available = (u, provider) =>
    u.purchased +
    lotsFor(u, provider).reduce((s, l) => s + l.remainingMicros, 0)
  const balance = (u, known = true) => {
    const lots = u.lots.filter(live)
    const next = lots
      .filter((l) => l.expiresAt)
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0]
    return {
      userId: u.userId,
      known,
      ...summary(u),
      byProvider: Object.fromEntries(
        ["anthropic", "openai", "elevenlabs"].map((p) => [p, available(u, p)]),
      ),
      lots,
      nextExpiry: next
        ? { at: next.expiresAt, micros: next.remainingMicros }
        : null,
      unit: UNIT,
      feeBps: FEE_BPS,
      autoRefill: { enabled: u.autoRefill.enabled, pending: false },
    }
  }
  const crossings = (u) => {
    const a = summary(u).availableMicros
    if (a < 500_000 && !u.low) {
      u.low = true
      emit("balance.low", {
        userId: u.userId,
        thresholdMicros: 500_000,
        balance: summary(u),
      })
    } else if (a >= 500_000) u.low = false
    if (a <= 0 && !u.empty) {
      u.empty = true
      emit("balance.empty", { userId: u.userId, balance: summary(u) })
    } else if (a > 0) u.empty = false
  }
  const charge = (u, call, provider, costMicros) => {
    let rest = costMicros,
      fromGrants = 0
    for (const lot of call.source === "own" ? [] : lotsFor(u, provider)) {
      const take = Math.min(lot.remainingMicros, rest)
      lot.remainingMicros -= take
      lot.spentMicros += take
      fromGrants += take
      rest -= take
      if (!rest) break
    }
    const fee = Math.ceil((rest * FEE_BPS) / 10000)
    // Shortfall: absorbed by the center; purchased never goes below zero.
    const shortfall = Math.max(0, rest + fee - u.purchased)
    u.purchased = Math.max(0, u.purchased - rest - fee)
    Object.assign(call, {
      status: "charged",
      costMicros,
      feeMicros: fee,
      chargedMicros: fromGrants + rest + fee,
      fromGrantsMicros: fromGrants,
      fromPurchasedMicros: rest + fee,
      shortfallMicros: shortfall,
      balanceAfterMicros: summary(u).availableMicros,
      finishedAt: now(),
      latencyMs: Date.now() - call.t0,
    })
    crossings(u)
    return call
  }
  const usd = (usage) =>
    (usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens) * 3 +
    usage.cacheReadTokens * 0.3 +
    (usage.cacheWriteTokens - usage.cacheWrite1hTokens) * 3.75 +
    usage.cacheWrite1hTokens * 6 +
    usage.outputTokens * 15 +
    (usage.units?.tts_chars ?? 0) * 15
  const costOf = (usage) => Math.ceil(usd(usage)) // $/M × tokens = micros
  // Calls are keyed `callId` on the wire (CallCharge / CallRecord), never `id`.
  const publicCall = ({ t0: _t0, id: callId, ...c }) => ({ callId, ...c })

  // ------------------------------------------------------------------ refunds
  // Bought credit is spent oldest purchase first, so what is left of the wallet belongs to the
  // newest purchases: refundable is what of a purchase's credit lies inside `purchased`.
  const refundable = (u, purchase) => {
    let room = u.purchased
    const paid = [...state.purchases.values()]
      .filter((x) => x.userId === u.userId && x.purchase.status === "paid")
      .reverse()
    for (const x of paid) {
      const left = Math.min(
        x.purchase.creditMicros - (x.refundedCredit ?? 0),
        room,
      )
      if (x.purchase.id === purchase.id) return Math.max(0, left)
      room -= Math.max(0, left)
    }
    return 0
  }
  // `POST /stub/mode {"presentment":{"currency":"cad","rate":1.37}}`: every buyer paid in that
  // currency, so the presentment fields are set (a refund's by pro rata, as the center's are).
  const presentmentOf = (purchase) => {
    const p = state.mode.presentment
    if (!p || !p.currency || !(p.rate > 0)) return null
    const paid = purchase.totalCents ?? purchase.amountCents
    return { currency: p.currency, total: Math.round(paid * p.rate), paid }
  }
  const withRefundFigures = (u, purchase) => {
    const x = state.purchases.get(purchase.id)
    const left = refundable(u, purchase)
    const paid = purchase.totalCents ?? purchase.amountCents
    const pm = presentmentOf(purchase)
    const refundableCents =
      left <= 0
        ? 0
        : Number(
            (BigInt(paid) * BigInt((x.refundedCredit ?? 0) + left)) /
              BigInt(purchase.creditMicros),
          ) - (x.refundedCents ?? 0)
    return {
      ...purchase,
      ...(pm
        ? {
            presentmentCurrency: pm.currency,
            presentmentTotalCents: pm.total,
            refundablePresentmentCents: Math.floor(
              (pm.total * refundableCents) / pm.paid,
            ),
          }
        : {}),
      refundableCreditMicros: left,
      refundableCents:
        left <= 0
          ? 0
          : Number(
              (BigInt(paid) * BigInt((x.refundedCredit ?? 0) + left)) /
                BigInt(purchase.creditMicros),
            ) - (x.refundedCents ?? 0),
      refundedCreditMicros: x.refundedCredit ?? 0,
      refundedCents: x.refundedCents ?? 0,
    }
  }

  // ------------------------------------------------------------------ webhooks
  const sign = (body, t = Math.floor(Date.now() / 1000)) =>
    `t=${t},v1=${createHmac("sha256", HOOK_SECRET).update(`${t}.${body}`).digest("hex")}`
  function emit(type, data) {
    const event = {
      id: id("evt"),
      type,
      createdAt: now(),
      appId: "app_stub",
      livemode: false,
      data,
    }
    if (!HOOK_URL) return event
    const body = JSON.stringify(event)
    const send = (attempt) =>
      fetch(HOOK_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "token-signature": sign(body),
          "token-event-id": event.id,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status))
        })
        .catch((e) => {
          if (attempt < 3) {
            const t = setTimeout(
              () => {
                timers.delete(t)
                send(attempt + 1)
              },
              1000 * 2 ** attempt,
            )
            t.unref?.()
            timers.add(t)
          } else console.error(`[stub] webhook ${type} dead: ${e.message}`)
        })
    send(0)
    return event
  }

  // ------------------------------------------------------------------ http helpers
  const readBody = (req) =>
    new Promise((ok, no) => {
      const b = []
      req.on("data", (c) => b.push(c))
      req.on("end", () => ok(Buffer.concat(b).toString("utf8")))
      req.on("error", no)
    })
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers })
    res.end(body === undefined ? "" : JSON.stringify(body))
  }
  const fail = (res, code, message, shape = "api", extra = {}) => {
    const detail = { code, message, ...extra }
    const body =
      shape === "anthropic"
        ? {
            type: "error",
            error: {
              type:
                code === "insufficient_balance"
                  ? "permission_error"
                  : "api_error",
              message,
            },
            token_center: detail,
          }
        : shape === "openai"
          ? { error: { message, type: code, code }, token_center: detail }
          : { error: detail }
    json(res, STATUS[code], body, {
      "x-token-error": code,
      ...(extra.callId ? { "x-token-call-id": extra.callId } : {}),
      ...(code === "provider_out_of_credit"
        ? { "x-should-retry": "false" }
        : {}),
      ...(extra.retryAfterSeconds !== undefined &&
      ["rate_limited", "provider_rate_limited", "provider_overloaded"].includes(
        code,
      )
        ? { "retry-after": String(extra.retryAfterSeconds) }
        : {}),
    })
  }
  const attribution = (req) =>
    Object.fromEntries(
      ["purpose", "activity", "scope", "job", "subject", "correlation"]
        .map((k) => [k, req.headers[`x-token-${k}`]])
        .filter(([, v]) => v)
        .map(([k, v]) => [k, decodeURIComponent(v).slice(0, 200)]),
    )
  const chargeHeaders = (c) => ({
    "x-token-call-id": c.id,
    "x-token-source": c.source,
    "x-token-model": c.model,
    "x-token-cost-micros": String(c.costMicros),
    "x-token-fee-micros": String(c.feeMicros),
    "x-token-charged-micros": String(c.chargedMicros),
    "x-token-balance-micros": String(c.balanceAfterMicros),
  })
  const zeroUsage = () => ({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    cacheWrite5mTokens: 0,
    totalTokens: 0,
  })
  const fromAnthropic = (u, x = {}) => {
    const read = x.cache_read_input_tokens ?? u.cacheReadTokens,
      write = x.cache_creation_input_tokens ?? u.cacheWriteTokens
    const input =
      x.input_tokens !== undefined
        ? x.input_tokens + read + write
        : u.inputTokens
    const output = x.output_tokens ?? u.outputTokens
    const write1h =
      x.cache_creation?.ephemeral_1h_input_tokens ?? u.cacheWrite1hTokens
    return {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: read,
      cacheWriteTokens: write,
      cacheWrite1hTokens: write1h,
      cacheWrite5mTokens: write - write1h,
      totalTokens: input + output,
    }
  }
  const fromOpenAI = (x) => ({
    inputTokens: x.prompt_tokens ?? 0,
    outputTokens: x.completion_tokens ?? 0,
    cacheReadTokens: x.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    cacheWrite5mTokens: 0,
    totalTokens: x.total_tokens ?? 0,
  })

  // ------------------------------------------------------------------ canned provider
  const sse = (res, events) => {
    for (const [event, data] of events)
      res.write(
        `${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`,
      )
  }
  const TEXT = env.TOKENS_STUB_REPLY ?? "Stub reply."
  const cannedAnthropic = (body) => ({
    id: id("msg"),
    type: "message",
    role: "assistant",
    model: body.model,
    content: [{ type: "text", text: TEXT }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  })
  const cannedAnthropicStream = (m) => [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          ...m,
          content: [],
          stop_reason: null,
          usage: { ...m.usage, output_tokens: 1 },
        },
      },
    ],
    [
      "content_block_start",
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
    ],
    [
      "content_block_delta",
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: TEXT },
      },
    ],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 20 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ]
  const cannedOpenAI = (body) => ({
    id: id("chatcmpl"),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: TEXT },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  })
  const cannedOpenAIStream = (c) => {
    const base = {
      id: c.id,
      object: "chat.completion.chunk",
      created: c.created,
      model: c.model,
    }
    return [
      [
        null,
        {
          ...base,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: TEXT },
              finish_reason: null,
            },
          ],
        },
      ],
      [
        null,
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ],
      [null, { ...base, choices: [], usage: c.usage }],
      [null, "[DONE]"],
    ]
  }

  // Forward to an upstream fake (or real) provider; meter what it reports. Returns usage.
  async function forward(
    req,
    res,
    upstream,
    path,
    raw,
    protocol,
    stream,
    headers,
  ) {
    const up = await fetch(upstream.replace(/\/$/, "") + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer stub",
        "x-api-key": "stub",
        "anthropic-version": req.headers["anthropic-version"] ?? "2023-06-01",
      },
      body: raw,
    })
    if (!stream || !up.ok) {
      const text = await up.text()
      let usage = zeroUsage()
      try {
        const j = JSON.parse(text)
        usage =
          protocol === "anthropic"
            ? fromAnthropic(usage, j.usage)
            : fromOpenAI(j.usage ?? {})
      } catch {
        /* not JSON or no usage: stays zero */
      }
      return { status: up.status, text, usage, ok: up.ok }
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      ...headers,
    })
    let usage = zeroUsage(),
      buf = ""
    for await (const chunk of up.body) {
      res.write(chunk)
      buf += Buffer.from(chunk).toString()
      const lines = buf.split("\n")
      buf = lines.pop()
      for (const line of lines)
        if (line.startsWith("data:")) {
          try {
            const j = JSON.parse(line.slice(5))
            if (protocol === "anthropic")
              usage = fromAnthropic(usage, j.message?.usage ?? j.usage)
            else if (j.usage) usage = fromOpenAI(j.usage)
          } catch {
            /* not JSON or no usage: stays zero */
          }
        }
    }
    return { status: 200, usage, ok: true, streamed: true }
  }

  // Real, playable audio: 12 MPEG-1 Layer III frames (128 kbps, 44.1 kHz, stereo, all-zero payload =
  // silence), about 0.3 s. Every decoder plays it; the length does not follow the text.
  const silentMp3 = () =>
    Buffer.concat(
      Array.from({ length: 12 }, () =>
        Buffer.concat([
          Buffer.from([0xff, 0xfb, 0x90, 0x00]),
          Buffer.alloc(413),
        ]),
      ),
    )

  // ------------------------------------------------------------------ gateway
  async function gateway(req, res, url, raw) {
    const shape = url.pathname === "/v1/messages" ? "anthropic" : "openai"
    const userId = req.headers["x-token-user"]
    if (!userId)
      return fail(res, "invalid_request", "x-token-user is required.", shape, {
        path: "x-token-user",
      })
    const u = user(
      decodeURIComponent(userId),
      req.headers["x-token-email"] &&
        decodeURIComponent(req.headers["x-token-email"]),
    )
    let body
    try {
      body = JSON.parse(raw || "{}")
    } catch {
      return fail(res, "invalid_request", "Body is not JSON.", shape)
    }
    const speech = url.pathname === "/v1/audio/speech"
    const backend = req.headers["x-token-backend"] === "own" ? "own" : "tokens"
    let model = speech
      ? VOICES.find((v) => v.id === (body.voice ?? "stub-voice")) &&
        "tts-stub-voice"
      : body.model
    const known = MODELS.find((m) => m.id === model)
    if (speech && !model) return fail(res, "not_found", "No such voice.", shape)
    if (!speech && backend === "tokens") {
      if (/unpriced/.test(model ?? ""))
        return fail(res, "model_not_priced", `${model} has no price.`, shape)
      if (!known)
        return fail(res, "unknown_model", `${model} is not offered.`, shape)
      if (known.protocol !== shape)
        return fail(
          res,
          "wrong_protocol",
          `${model} is served on the other endpoint.`,
          shape,
        )
    }
    if (backend === "own") {
      if (shape !== "openai" || speech)
        return fail(
          res,
          "wrong_protocol",
          "Own endpoints speak chat completions.",
          shape,
        )
      if (!u.own)
        return fail(
          res,
          "byo_not_configured",
          "No own endpoint saved.",
          shape,
          { action: "configure_own" },
        )
      if (!u.own.models.includes(model)) model = u.own.defaultModel
    }
    const provider = speech
      ? "openai"
      : backend === "own"
        ? "own"
        : known.provider
    if (backend === "tokens" && available(u, provider) <= 0)
      return fail(res, "insufficient_balance", "Out of tokens.", shape, {
        action: "buy_tokens",
        provider,
      })
    const endpoint = speech
      ? "speech"
      : shape === "anthropic"
        ? "messages"
        : "chat_completions"
    const call = {
      id: id("call"),
      t0: Date.now(),
      userId: u.userId,
      status: "admitted",
      endpoint,
      provider,
      source: backend,
      requestedModel: body.model ?? model,
      model,
      stream: !!body.stream,
      attribution: attribution(req),
      error: null,
      createdAt: now(),
      finishedAt: null,
      latencyMs: null,
      usage: zeroUsage(),
      costMicros: 0,
      feeMicros: 0,
      chargedMicros: 0,
      fromGrantsMicros: 0,
      fromPurchasedMicros: 0,
      shortfallMicros: 0,
      balanceAfterMicros: 0,
    }
    state.calls.push(call)
    if (state.mode.providerError) {
      Object.assign(call, {
        status: "failed",
        finishedAt: now(),
        error: {
          code: "provider_error",
          message: "Stub provider error.",
          status: 529,
        },
      })
      return fail(res, "provider_error", "The provider failed.", shape, {
        status: 529,
        callId: call.id,
      })
    }
    const failKind = FAILS[req.headers["x-stub-fail"]]
      ? req.headers["x-stub-fail"]
      : state.mode.fail
    const failing =
      backend === "tokens" &&
      failKind &&
      (!speech || (body.voice ?? "stub-voice") !== "stub-voice-eleven")
    if (failing && !speech) {
      const code = FAILS[failKind]
      const name = PROVIDER_NAME[provider]
      const message =
        failKind === "out_of_credit"
          ? `The ${name} account behind the token center is out of credit; nothing was charged.`
          : failKind === "overloaded"
            ? `${name} is overloaded; nothing was charged. Try again shortly.`
            : `${name} is rate limiting the token center; nothing was charged. Try again shortly.`
      Object.assign(call, {
        status: "failed",
        finishedAt: now(),
        error: { code, message, provider, model },
      })
      return fail(res, code, message, shape, {
        provider,
        model,
        callId: call.id,
        ...(failKind === "out_of_credit" ? {} : { retryAfterSeconds: 7 }),
      })
    }
    // Speech does not fail: it falls back to the app's other voice, on a provider that is not failing.
    let fallbackVoice = null
    if (failing && speech) {
      fallbackVoice = "stub-voice-eleven"
      call.model = fallbackVoice
      call.provider = "elevenlabs"
    }
    if (speech) {
      const chars = [...String(body.input ?? "")].length
      if (!chars || chars > 4096) {
        call.status = "failed"
        return fail(
          res,
          "invalid_request",
          "input must be 1..4096 characters.",
          shape,
          { path: "input" },
        )
      }
      call.usage = { ...zeroUsage(), units: { tts_chars: chars } }
      charge(u, call, call.provider, costOf(call.usage))
      const audio = silentMp3()
      res.writeHead(200, {
        "content-type": "audio/mpeg",
        "x-token-chars": String(chars),
        ...(fallbackVoice ? { "x-token-voice-fallback": fallbackVoice } : {}),
        ...chargeHeaders(call),
      })
      return res.end(audio)
    }
    if (shape === "openai" && body.stream) {
      body.stream_options = { ...body.stream_options, include_usage: true }
      raw = JSON.stringify(body)
    }
    const upstream =
      backend === "own" ? (u.own.upstream ?? UP.openai) : UP[shape]
    const head = {
      "x-token-call-id": call.id,
      "x-token-source": call.source,
      "x-token-model": call.model,
    }
    const trailer = () => {
      if (req.headers["x-token-trailer"] === "event")
        sse(res, [["token_center", publicCall(call)]])
    }
    if (upstream) {
      const out = await forward(
        req,
        res,
        upstream,
        url.pathname.replace(/^\/v1/, ""),
        raw,
        shape,
        !!body.stream,
        head,
      )
      call.usage = out.usage
      if (!out.ok) {
        charge(u, call, provider, backend === "own" ? 0 : costOf(out.usage))
        call.status = "failed"
        return fail(
          res,
          backend === "own" ? "byo_failed" : "provider_error",
          `Upstream answered ${out.status}.`,
          shape,
          { status: out.status, callId: call.id },
        )
      }
      charge(u, call, provider, backend === "own" ? 0 : costOf(out.usage))
      if (out.streamed) {
        trailer()
        return res.end()
      }
      res.writeHead(200, {
        "content-type": "application/json",
        ...chargeHeaders(call),
      })
      return res.end(out.text)
    }
    const message =
      shape === "anthropic"
        ? cannedAnthropic({ ...body, model })
        : cannedOpenAI({ ...body, model })
    call.usage =
      shape === "anthropic"
        ? fromAnthropic(zeroUsage(), message.usage)
        : fromOpenAI(message.usage)
    if (!body.stream) {
      charge(u, call, provider, backend === "own" ? 0 : costOf(call.usage))
      return json(res, 200, message, chargeHeaders(call))
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      ...head,
    })
    sse(
      res,
      shape === "anthropic"
        ? cannedAnthropicStream(message)
        : cannedOpenAIStream(message),
    )
    charge(u, call, provider, backend === "own" ? 0 : costOf(call.usage))
    trailer()
    res.end()
  }

  // ------------------------------------------------------------------ app API
  const page = (calls, q) => {
    const f = calls
      .filter(
        (c) =>
          (!q.get("userId") || c.userId === q.get("userId")) &&
          ["scope", "job", "correlation", "purpose"].every(
            (k) => !q.get(k) || c.attribution[k] === q.get(k),
          ) &&
          (!q.get("source") || c.source === q.get("source")) &&
          (!q.get("since") || c.createdAt >= q.get("since")),
      )
      .reverse()
    const start = Number(q.get("cursor") ?? 0),
      limit = Math.min(Number(q.get("limit") ?? 50), 200)
    const sum = (k) => f.reduce((s, c) => s + (c[k] ?? c.usage[k] ?? 0), 0)
    return {
      calls: f.slice(start, start + limit).map(publicCall),
      nextCursor: start + limit < f.length ? String(start + limit) : null,
      totals: {
        count: f.length,
        ...Object.fromEntries(
          [
            "costMicros",
            "feeMicros",
            "chargedMicros",
            "inputTokens",
            "outputTokens",
            "cacheReadTokens",
            "cacheWriteTokens",
            "cacheWrite5mTokens",
            "cacheWrite1hTokens",
            "totalTokens",
          ].map((k) => [k, sum(k)]),
        ),
      },
    }
  }
  const ownView = (u) =>
    u.own && {
      ...u.own,
      apiKey: undefined,
      upstream: undefined,
      order: u.order,
    }
  async function api(req, res, url, raw) {
    const p = url.pathname,
      m = req.method,
      q = url.searchParams
    let body = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      return fail(res, "invalid_request", "Body is not JSON.")
    }
    if (p === "/api/v1/app")
      return json(res, 200, {
        id: "app_stub",
        name: "Stub app",
        unit: UNIT,
        purchaseOptions: OPTIONS,
        feeBps: FEE_BPS,
        lowBalanceMicros: 500_000,
        maxInFlightPerUser: 4,
        livemode: false,
        returnOrigins: ["http://localhost", "http://127.0.0.1"],
      })
    if (p === "/api/v1/models") return json(res, 200, { models: MODELS })
    if (p === "/api/v1/voices") return json(res, 200, { voices: VOICES })
    if (p === "/api/v1/sale-prices")
      return json(res, 200, {
        prices: SALE,
        feeBps: FEE_BPS,
        paymentsAvailable: true,
        options: OPTIONS,
      })
    if (p === "/api/v1/calls") return json(res, 200, page(state.calls, q))
    let r = p.match(/^\/api\/v1\/calls\/([^/]+)$/)
    if (r) {
      const c = state.calls.find((x) => x.id === r[1])
      return c
        ? json(res, 200, publicCall(c))
        : fail(res, "not_found", "No such call.")
    }
    if (p === "/api/v1/route") {
      if (!body.userId || !body.model)
        return fail(
          res,
          "invalid_request",
          "userId and model are needed.",
          "api",
          { path: body.userId ? "model" : "userId" },
        )
      const u = user(body.userId),
        needs = body.needs ?? [],
        own =
          u.own &&
          u.order !== "tokens_only" &&
          needs.every((n) => n !== "voice" && u.own.capabilities.includes(n))
      const ownFirst =
        own &&
        (u.order === "own_only" ||
          u.order === "own_then_tokens" ||
          (u.order === "tokens_then_own" &&
            available(
              u,
              MODELS.find((x) => x.id === body.model)?.provider ?? "anthropic",
            ) <= 0))
      const known = MODELS.find((x) => x.id === body.model)
      if (ownFirst)
        return json(res, 200, {
          source: "own",
          protocol: "openai",
          model: u.own.models.includes(body.model)
            ? body.model
            : u.own.defaultModel,
          backend: "own",
          fallback: null,
          availableMicros: summary(u).availableMicros,
        })
      if (!known)
        return fail(
          res,
          /unpriced/.test(body.model ?? "")
            ? "model_not_priced"
            : "unknown_model",
          `${body.model} is not offered.`,
        )
      const missing =
        u.own &&
        u.order !== "tokens_only" &&
        needs.find((n) => n === "voice" || !u.own.capabilities.includes(n))
      if (available(u, known.provider) <= 0)
        return fail(
          res,
          missing ? "capability_unavailable" : "insufficient_balance",
          missing ? `Your own service can't do ${missing}.` : "Out of tokens.",
          "api",
          { action: "buy_tokens", ...(missing ? { capability: missing } : {}) },
        )
      return json(res, 200, {
        source: "tokens",
        protocol: known.protocol,
        model: known.id,
        backend: "tokens",
        fallback:
          missing && u.order !== "tokens_then_own"
            ? { reason: "capability", capability: missing }
            : null,
        availableMicros: available(u, known.provider),
      })
    }
    r = p.match(/^\/api\/v1\/users\/([^/]+)(\/.*)?$/)
    if (!r) return fail(res, "not_found", "No such endpoint.")
    const userId = decodeURIComponent(r[1]),
      rest = r[2] ?? "",
      seen = state.users.has(userId),
      u = user(userId)
    if (rest === "" && m === "PUT") {
      if (body.email !== undefined) u.email = body.email
      if (body.displayName !== undefined) u.displayName = body.displayName
      const { userId: i, email, displayName, createdAt, lastSeenAt } = u
      return json(res, 200, {
        userId: i,
        email,
        displayName,
        createdAt,
        lastSeenAt,
      })
    }
    if (rest === "/balance") return json(res, 200, balance(u, seen))
    if (rest === "/calls") {
      q.set("userId", userId)
      return json(res, 200, page(state.calls, q))
    }
    if (rest === "/history")
      return json(res, 200, {
        entries: [...u.history].reverse(),
        nextCursor: null,
      })
    if (rest === "/checkout" && m === "POST") {
      const price = SALE.find((s) => s.currency === body.currency)
      if (!price)
        return fail(res, "invalid_request", "Unknown currency.", "api", {
          path: "currency",
        })
      if (!(body.amountCents >= OPTIONS.minimumCents))
        return fail(
          res,
          "purchase_too_small",
          "The smallest amount is 5.",
          "api",
          { minimumCents: OPTIONS.minimumCents },
        )
      if (
        body.amountCents > OPTIONS.maximumCents ||
        (OPTIONS.packsOnly && !OPTIONS.packsCents.includes(body.amountCents))
      )
        return fail(
          res,
          "invalid_request",
          "That amount is not offered.",
          "api",
          { path: "amountCents" },
        )
      const purchase = {
        id: id("pur"),
        kind: "checkout",
        status: "open",
        currency: body.currency,
        amountCents: body.amountCents,
        taxCents: null,
        totalCents: null,
        creditMicros: Math.floor(
          (body.amountCents * 1_000_000) / price.centsPerDollar,
        ),
        failure: null,
        createdAt: now(),
        paidAt: null,
      }
      state.purchases.set(purchase.id, {
        purchase,
        userId,
        successUrl: body.successUrl,
        saveCard: !!body.saveCard,
      })
      return json(res, 201, {
        purchaseId: purchase.id,
        url: `http://localhost:${PORT}/stub/checkout/${purchase.id}`,
        expiresAt: new Date(Date.now() + 86400e3).toISOString(),
        creditMicros: purchase.creditMicros,
      })
    }
    if (rest === "/purchases" && m === "GET") {
      const mine = [...state.purchases.values()]
        .filter((x) => x.userId === userId && x.purchase.status === "paid")
        .reverse()
        .map((x) => withRefundFigures(u, x.purchase))
      const start = Number(q.get("cursor") ?? 0),
        limit = Math.min(Number(q.get("limit") ?? 50), 200)
      return json(res, 200, {
        purchases: mine.slice(start, start + limit),
        nextCursor: start + limit < mine.length ? String(start + limit) : null,
      })
    }
    r = rest.match(/^\/purchases\/([^/]+)\/refund$/)
    if (r && m === "POST") {
      const x = state.purchases.get(r[1])
      if (!x || x.userId !== userId)
        return fail(res, "not_found", "No such purchase.")
      const key = req.headers["idempotency-key"]
      const kept = key && state.refunds.get(`${r[1]}:${key}`)
      if (kept) return json(res, kept.status === "pending" ? 202 : 201, kept)
      const left = refundable(u, x.purchase)
      if (x.purchase.status !== "paid" || left <= 0)
        return fail(
          res,
          "refund_not_available",
          "There is nothing left of this purchase to refund.",
          "api",
          { refundableCreditMicros: 0 },
        )
      const credit = body.creditMicros ?? left
      if (!Number.isSafeInteger(credit) || credit <= 0 || credit > left)
        return fail(
          res,
          "refund_amount_invalid",
          "That is not an amount this purchase can refund.",
          "api",
          { refundableCreditMicros: left },
        )
      if (state.mode.refundRefused)
        return fail(
          res,
          "refund_refused_by_processor",
          "The payment processor will not refund this payment any more.",
        )
      const pending = !!state.mode.refundPending
      const paid = x.purchase.totalCents ?? x.purchase.amountCents
      const refund = {
        id: id("ref"),
        purchaseId: x.purchase.id,
        status: pending ? "pending" : "succeeded",
        creditMicros: credit,
        amountCents:
          Number(
            (BigInt(paid) * BigInt((x.refundedCredit ?? 0) + credit)) /
              BigInt(x.purchase.creditMicros),
          ) - (x.refundedCents ?? 0),
        currency: x.purchase.currency,
        initiatedBy: "app",
        failure: null,
        createdAt: now(),
        settledAt: pending ? null : now(),
      }
      const pm = presentmentOf(x.purchase)
      if (pm) {
        refund.presentmentCurrency = pm.currency
        refund.presentmentAmountCents = Math.floor(
          (pm.total * refund.amountCents) / pm.paid,
        )
      }
      u.purchased -= credit
      x.refundedCredit = (x.refundedCredit ?? 0) + credit
      x.refundedCents = (x.refundedCents ?? 0) + refund.amountCents
      state.refunds.set(`${r[1]}:${key}`, refund)
      u.history.push({ type: "refund", at: refund.createdAt, refund })
      crossings(u)
      if (!pending)
        emit("purchase.refunded", {
          userId: u.userId,
          purchase: withRefundFigures(u, x.purchase),
          refund,
          balance: summary(u),
        })
      return json(res, pending ? 202 : 201, refund)
    }
    r = rest.match(/^\/purchases\/([^/]+)$/)
    if (r) {
      const x = state.purchases.get(r[1])
      return x && x.userId === userId
        ? json(
            res,
            200,
            x.purchase.status === "paid"
              ? withRefundFigures(u, x.purchase)
              : x.purchase,
          )
        : fail(res, "not_found", "No such purchase.")
    }
    if (rest === "/autorefill") {
      if (m === "PUT") {
        // Only the settings: a card or payment method is never accepted here.
        const fields = [
          "enabled",
          "thresholdMicros",
          "amountCents",
          "currency",
          "monthlyMaxCents",
        ]
        const unknown = Object.keys(body).filter((k) => !fields.includes(k))
        if (unknown.length)
          return fail(
            res,
            "invalid_request",
            `Auto-refill takes only its settings; ${unknown.join(", ")} is not one.`,
            "api",
            { path: unknown[0] },
          )
        if (body.enabled && !u.autoRefill.card)
          return fail(res, "no_card", "Save a card first.")
        for (const k of fields)
          if (body[k] !== undefined) u.autoRefill[k] = body[k]
      }
      return json(res, 200, u.autoRefill)
    }
    if (rest === "/card" && m === "POST")
      return json(res, 201, {
        url: `http://localhost:${PORT}/stub/card/${encodeURIComponent(userId)}?to=${encodeURIComponent(body.successUrl)}`,
        expiresAt: new Date(Date.now() + 86400e3).toISOString(),
      })
    if (rest === "/card" && m === "DELETE") {
      u.autoRefill.card = null
      u.autoRefill.enabled = false
      return json(res, 204)
    }
    if (rest === "/own-endpoint") {
      if (m === "GET") return json(res, 200, u.own ? ownView(u) : null)
      if (m === "DELETE") {
        u.own = null
        u.order = "tokens_only"
        return json(res, 204)
      }
      if (!/^https?:\/\//.test(body.baseUrl ?? "") || !body.models?.length)
        return fail(
          res,
          "invalid_request",
          "baseUrl and models are needed.",
          "api",
          { path: "baseUrl" },
        )
      const key = body.apiKey === undefined ? u.own?.apiKey : body.apiKey
      u.own = {
        baseUrl: body.baseUrl,
        apiKey: key,
        hasKey: !!key,
        keyHint: key ? key.slice(-4) : null,
        models: body.models,
        defaultModel: body.defaultModel ?? body.models[0],
        capabilities: body.capabilities ?? [],
        toolChoice: body.toolChoice === "required" ? "required" : "auto",
        monthlyTokenLimit: body.monthlyTokenLimit ?? null,
        usedThisMonth: 0,
        periodEndsAt: new Date(
          Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1),
        ).toISOString(),
        lastTest: null,
        upstream: env.TOKENS_STUB_OWN_UPSTREAM || null,
      }
      u.order = body.order ?? "own_then_tokens"
      return json(res, 200, ownView(u))
    }
    if (rest === "/own-endpoint/test") {
      if (!u.own)
        return fail(res, "byo_not_configured", "No own endpoint saved.")
      u.own.lastTest = {
        ok: !/fail/.test(u.own.baseUrl),
        at: now(),
        latencyMs: 42,
        models: u.own.models,
        error: /fail/.test(u.own.baseUrl)
          ? {
              code: "byo_failed",
              message: "The endpoint answered 401.",
              status: 401,
            }
          : null,
      }
      return json(res, 200, u.own.lastTest)
    }
    if (rest === "/backend-order" && m === "PUT") {
      if (!u.own && body.order !== "tokens_only")
        return fail(res, "byo_not_configured", "Save an own endpoint first.")
      u.order = body.order
      return json(res, 200, { order: u.order })
    }
    return fail(res, "not_found", "No such endpoint.")
  }

  // ------------------------------------------------------------------ stub controls (no auth)
  async function control(req, res, url, raw) {
    const body = raw ? JSON.parse(raw) : {}
    if (url.pathname === "/stub/reset") {
      reset()
      return json(res, 200, { ok: true })
    }
    if (url.pathname === "/stub/mode") {
      Object.assign(state.mode, body)
      return json(res, 200, state.mode)
    }
    if (url.pathname === "/stub/state")
      return json(res, 200, {
        users: [...state.users.values()].map((u) => balance(u)),
        calls: state.calls.map(publicCall),
        mode: state.mode,
      })
    if (url.pathname === "/stub/balance") {
      const u = user(body.userId)
      u.purchased = body.purchasedMicros
      crossings(u)
      return json(res, 200, balance(u))
    }
    if (url.pathname === "/stub/grant") {
      const u = user(body.userId)
      if (body.provider === null)
        return fail(
          res,
          "invalid_request",
          "Every lot is locked to one provider.",
          "api",
          { path: "provider" },
        )
      const lot = {
        id: id("lot"),
        kind: body.kind ?? "airdrop",
        provider: body.provider ?? "anthropic",
        grantedMicros: body.micros,
        spentMicros: 0,
        remainingMicros: body.micros,
        expiresAt: body.expiresAt ?? null,
        reason: body.reason ?? null,
        createdAt: now(),
      }
      u.lots.push(lot)
      u.history.push({ type: "grant", at: lot.createdAt, lot })
      crossings(u)
      return json(
        res,
        200,
        emit("grant.received", {
          userId: u.userId,
          source: lot.kind,
          lot,
          airdropId: lot.kind === "airdrop" ? id("drop") : null,
          balance: summary(u),
        }),
      )
    }
    if (url.pathname === "/stub/expire") {
      for (const u of state.users.values())
        for (const lot of u.lots)
          if (lot.id === body.lotId && lot.remainingMicros > 0) {
            const expiredMicros = lot.remainingMicros
            lot.remainingMicros = 0
            lot.expiresAt = now()
            u.history.push({
              type: "expiry",
              at: now(),
              lotId: lot.id,
              expiredMicros,
            })
            crossings(u)
            return json(
              res,
              200,
              emit("grant.expired", {
                userId: u.userId,
                lot,
                expiredMicros,
                balance: summary(u),
              }),
            )
          }
      return fail(res, "not_found", "No such live lot.")
    }
    if (url.pathname === "/stub/autorefill-fail") {
      const u = user(body.userId)
      u.autoRefill.enabled = false
      u.autoRefill.failedAt = now()
      return json(
        res,
        200,
        emit("autorefill.failed", {
          userId: u.userId,
          purchaseId: null,
          reason: "Your card was declined.",
        }),
      )
    }
    let r = url.pathname.match(/^\/stub\/checkout\/([^/]+)$/)
    if (r) {
      const x = state.purchases.get(r[1])
      if (!x) return fail(res, "not_found", "No such purchase.")
      if (x.purchase.status === "open") {
        const u = user(x.userId)
        Object.assign(x.purchase, {
          status: "paid",
          paidAt: now(),
          taxCents: 0,
          totalCents: x.purchase.amountCents,
        })
        u.purchased += x.purchase.creditMicros
        if (x.saveCard) u.autoRefill.card = { label: "Visa ending 4242" }
        u.history.push({ type: "purchase", at: now(), purchase: x.purchase })
        crossings(u)
        emit("purchase.completed", {
          userId: u.userId,
          purchase: x.purchase,
          balance: summary(u),
        })
      }
      res.writeHead(303, {
        location: (x.successUrl ?? "/").replace("{PURCHASE_ID}", x.purchase.id),
      })
      return res.end()
    }
    r = url.pathname.match(/^\/stub\/card\/([^/]+)$/)
    if (r) {
      user(decodeURIComponent(r[1])).autoRefill.card = {
        label: "Visa ending 4242",
      }
      res.writeHead(303, { location: url.searchParams.get("to") ?? "/" })
      return res.end()
    }
    return fail(res, "not_found", "No such stub control.")
  }

  // ------------------------------------------------------------------ server
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    try {
      const raw = await readBody(req)
      if (url.pathname.startsWith("/stub/"))
        return await control(req, res, url, raw)
      const shape =
        url.pathname === "/v1/messages"
          ? "anthropic"
          : url.pathname.startsWith("/v1/")
            ? "openai"
            : "api"
      if (state.mode.down)
        return fail(
          res,
          "center_unavailable",
          "The token center is unavailable.",
          shape,
        )
      const key =
        req.headers["x-api-key"] ??
        (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "")
      if (!key || (KEY && key !== KEY))
        return fail(res, "unauthenticated", "Unknown app key.", shape)
      if (url.pathname === "/v1/models")
        return json(res, 200, {
          object: "list",
          data: MODELS.map((x) => ({
            id: x.id,
            object: "model",
            type: "model",
            display_name: x.displayName,
            created: 1767225600,
            created_at: PRICE.effectiveFrom,
            owned_by: x.provider,
          })),
          has_more: false,
          first_id: MODELS[0].id,
          last_id: MODELS.at(-1).id,
        })
      if (
        req.method === "POST" &&
        ["/v1/messages", "/v1/chat/completions", "/v1/audio/speech"].includes(
          url.pathname,
        )
      )
        return await gateway(req, res, url, raw)
      if (url.pathname.startsWith("/api/v1/"))
        return await api(req, res, url, raw)
      fail(res, "not_found", "No such endpoint.", shape)
    } catch (e) {
      console.error("[stub]", e)
      if (!res.headersSent) fail(res, "internal_error", "Stub error.")
      else res.end()
    }
  })
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(PORT, () => {
      PORT = server.address().port
      resolve({
        url: `http://localhost:${PORT}`,
        port: PORT,
        reset,
        close: () =>
          new Promise((done) => {
            for (const t of timers) clearTimeout(t)
            timers.clear()
            server.closeAllConnections?.()
            server.close(() => done())
          }),
      })
    })
  })
}
