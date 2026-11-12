/**
 * `createCredits`: the credit system an app wires in, over its own database.
 *
 * It answers the two questions every metered call asks -- may this user start it
 * (`admit`, or `beforeCall` for a hook that refuses by throwing), and what did it cost
 * (`onUsage`: write the ledger row and spend it) -- and hands the app the store for its admin
 * and billing screens. Notifications, the admin's identity and which models are offered stay
 * the app's: they arrive as callbacks.
 */

import { fail, ok, type Result } from "@kaperkunde/next-kit"

import { admitted, outOfCreditsMessage, type CreditBalance } from "./balance"
import type { CreditNames, Executor } from "./executor"
import type { RequestTokens } from "./pricing"
import { createStore, type LedgerInsert, type UsageRow } from "./store"
import { DEFAULT_UNIT, type CreditUnit } from "./units"

/** One request of a call as `@kaperkunde/ai` reports it. */
export type UsageRequest = RequestTokens & { reasoningTokens?: number | null }

/**
 * What a call cost, as a hook hands it over: an LLM call's requests, or a metered quantity of
 * one price kind (`{ kind: "tts_chars", units: 1200 }`), or both.
 */
export type UsageInput = {
  userId: string
  model: string
  /** Which piece of work asked; the app's own words. */
  purpose: string
  /**
   * `llm` (the default) for prompt-and-answer calls; otherwise the price kind `units` counts,
   * which is also written as the ledger row's kind.
   */
  kind?: string
  /** `own` for a call on the user's own key: written at no credits, never spent. */
  source?: "deployment" | "own"
  requests?: readonly UsageRequest[]
  /** A quantity of `kind`, or quantities by price kind. */
  units?: number | Readonly<Record<string, number>>
  scopeId?: string | null
  jobId?: string | null
  activity?: string | null
}

/** Splits a hook's usage into the ledger's columns. Pure. */
export const ledgerRowOf = (input: UsageInput): LedgerInsert => {
  const requests = input.requests ?? []
  const sum = (key: keyof UsageRequest) =>
    requests.reduce((total, request) => total + (Number(request[key]) || 0), 0)
  const kind = input.kind ?? "llm"
  const units =
    typeof input.units === "number"
      ? { [kind]: input.units }
      : input.units
        ? { ...input.units }
        : null
  const first = <KEY extends "inferenceGeo" | "speed" | "serviceTier">(
    key: KEY,
  ) => requests.find((request) => request[key])?.[key] ?? null
  const inputTokens = sum("inputTokens")
  const outputTokens = sum("outputTokens")
  return {
    userId: input.userId,
    model: input.model,
    purpose: input.purpose,
    kind,
    scopeId: input.scopeId ?? null,
    jobId: input.jobId ?? null,
    activity: input.activity ?? null,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedTokens: sum("cachedTokens"),
    cacheWriteTokens: sum("cacheWriteTokens"),
    cacheWrite1hTokens: sum("cacheWrite1hTokens"),
    reasoningTokens: sum("reasoningTokens"),
    units,
    requests: requests.length > 0 ? requests : null,
    inferenceGeo: first("inferenceGeo"),
    speed: first("speed"),
    serviceTier: first("serviceTier"),
    own: input.source === "own",
  }
}

export type AdmitRefusal = "OUT_OF_CREDITS" | "UNPRICED" | "OWN_LIMIT"

/**
 * The price kinds a call will need: `input` and `output` for a prompt-and-answer call (no kind,
 * or `llm`), the kind itself (or each of several) for a metered one. Pure.
 */
export const kindsNeeded = (kind?: string | readonly string[]): string[] => {
  const kinds = typeof kind === "string" ? [kind] : [...(kind ?? [])]
  const needed = kinds.flatMap((one) =>
    one === "llm" ? ["input", "output"] : [one],
  )
  return needed.length > 0 ? Array.from(new Set(needed)) : ["input", "output"]
}

/** What `admit` asks about a call. */
export type AdmitContext = {
  model: string
  source?: "deployment" | "own"
  /**
   * The price kind the call will use: none (or `llm`) for a prompt-and-answer call, which needs
   * `input` and `output`; `tts_chars` and the like for a metered call; several for both.
   */
  kind?: string | readonly string[]
}

/** Thrown by `beforeCall`, for a hook that refuses a call by throwing. */
export class CreditsRefusedError extends Error {
  readonly code: AdmitRefusal
  constructor(code: AdmitRefusal, message: string) {
    super(message)
    this.name = "CreditsRefusedError"
    this.code = code
  }
}

export type CreditsConfig = {
  db: Executor
  /** The template variables the migrations were rendered with. */
  names?: CreditNames
  /** What the app calls its credits. */
  unit?: CreditUnit
  /**
   * Told once a month when a user is refused for want of credits (claimed in the database
   * first, so a burst of refusals tells them once). Failures are swallowed.
   */
  onOutOfCredits?: (userId: string, message: string) => Promise<void> | void
  /** Told once a month when a user's own key reaches its limit. */
  onOwnLimit?: (userId: string, message: string) => Promise<void> | void
  /**
   * Run after every spend that came out of credits, fire and forget: where auto-refill is
   * asked (`createPurchases(...).maybeRefill`).
   */
  afterSpend?: (userId: string) => Promise<unknown> | void
  /** Where a failure in a fire-and-forget step is reported; console.error by default. */
  log?: (message: string, error: unknown) => void
}

/** What an admitted call may run on. */
export type Admission = {
  balance?: CreditBalance
  source: "deployment" | "own"
}

export const createCredits = (config: CreditsConfig) => {
  const store = createStore(config.db, config.names)
  const unit = config.unit ?? DEFAULT_UNIT
  const log =
    config.log ??
    ((message: string, error: unknown) => console.error(message, error))

  const tellOut = async (userId: string, message: string) => {
    if (!config.onOutOfCredits) return
    try {
      if (await store.claimOutNotice(userId)) {
        await config.onOutOfCredits(userId, message)
      }
    } catch (error) {
      log("A user could not be told they ran out of credits", error)
    }
  }

  /**
   * Whether a user may start a call. On the deployment's model: the model has a price in
   * force, and they have credits left after asking for free ones from the pool -- which is
   * what hands them out, so ask only when credits are what the call will run on. On their own
   * key: their monthly limit is not yet reached.
   */
  const unpriced = (model: string, missing: readonly string[]) =>
    fail(
      "UNPRICED" as const,
      `${model} has no price set here for ${missing.join(", ")} yet, so it cannot be used. Choose another model.`,
    )

  const admit = async (
    userId: string,
    context: AdmitContext,
  ): Promise<Result<Admission, AdmitRefusal>> => {
    if (context.source === "own") {
      const backend = await store.ownBackend(userId)
      if (backend?.tokenLimit !== null && backend?.tokenLimit !== undefined) {
        const spent = await store.ownSpent(userId)
        if (spent >= backend.tokenLimit) {
          const message =
            "Your own key has reached the limit you set for this month. It starts again next month, or you can raise the limit."
          if (config.onOwnLimit && (await store.claimOwnLimitNotice(userId))) {
            await Promise.resolve(config.onOwnLimit(userId, message)).catch(
              (error) =>
                log("A user could not be told of their key's limit", error),
            )
          }
          return fail("OWN_LIMIT", message)
        }
      }
      return ok({ source: "own" as const })
    }
    const call = { model: context.model, kinds: kindsNeeded(context.kind) }
    const missing = await store.missingKinds(call)
    if (missing.length > 0) return unpriced(context.model, missing)
    const balance = await store.admit(userId, call)
    if (admitted(balance)) return ok({ balance, source: "deployment" as const })
    const message = outOfCreditsMessage(unit)
    await tellOut(userId, message)
    return fail("OUT_OF_CREDITS", message)
  }

  /**
   * Whether `admit` would admit a call on credits now, changing nothing and handing nothing
   * out: what a paused job asks before it tries again.
   */
  const wouldAdmit = async (
    userId: string,
    context: Omit<AdmitContext, "source">,
  ): Promise<Result<{ kinds: string[] }, "OUT_OF_CREDITS" | "UNPRICED">> => {
    const call = { model: context.model, kinds: kindsNeeded(context.kind) }
    const missing = await store.missingKinds(call)
    if (missing.length > 0) return unpriced(context.model, missing)
    return (await store.wouldAdmit(userId, call))
      ? ok({ kinds: call.kinds })
      : fail("OUT_OF_CREDITS", outOfCreditsMessage(unit))
  }

  /** `admit` for a hook that refuses by throwing `CreditsRefusedError`. */
  const beforeCall = async (context: AdmitContext & { userId: string }) => {
    const verdict = await admit(context.userId, context)
    if (!verdict.ok)
      throw new CreditsRefusedError(verdict.code, verdict.message)
    return verdict
  }

  /** Writes a call to the ledger, unconverted (or at no credits, for the user's own key). */
  const recordUsage = (input: UsageInput) =>
    store.insertUsage(ledgerRowOf(input))

  /** Converts one ledger row into credits and takes them from its user. Idempotent. */
  const spend = (usageId: number) => store.spend(usageId)

  const askAfterSpend = (userId: string) => {
    if (!config.afterSpend) return
    Promise.resolve()
      .then(() => config.afterSpend?.(userId))
      .catch((error) => log("Auto-refill could not be asked about", error))
  }

  /**
   * The ledger and the spend in one, for a hook's `onUsage`: written, then (unless it ran on
   * the user's own key) converted and taken, then `afterSpend` asked without waiting on it.
   * The call has already happened, so a spend that fails (a kind nobody priced) is logged and
   * the row handed back unconverted (`credits` null), for `spendPending` to take later; only a
   * failure to write the row at all is thrown.
   */
  const onUsage = async (input: UsageInput): Promise<UsageRow> => {
    const row = await recordUsage(input)
    if (input.source === "own") return row
    try {
      const spent = await spend(row.id)
      askAfterSpend(input.userId)
      return spent
    } catch (error) {
      log(`Call ${row.id} is on the ledger but could not be spent yet`, error)
      return row
    }
  }

  /**
   * Spends every ledger row that was written and never converted -- a spend refused for a
   * kind nobody priced, or a process that stopped between the write and the spend -- once its
   * price covers it. Call it from a cron (every few minutes is plenty): it is what keeps an
   * unpriced call from running free. A row that still cannot be priced stays pending and is
   * named in `stillPending`; nothing is thrown for it.
   */
  const spendPending = async (options: { limit?: number } = {}) => {
    const rows = await store.pendingUsage(options.limit ?? 100)
    const spent: UsageRow[] = []
    const stillPending: { id: number; model: string; error: string }[] = []
    for (const row of rows) {
      try {
        spent.push(await spend(row.id))
      } catch (error) {
        stillPending.push({
          id: row.id,
          model: row.model,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    new Set(spent.map((row) => row.userId)).forEach(askAfterSpend)
    return { spent, stillPending }
  }

  return {
    store,
    unit,
    admit,
    wouldAdmit,
    beforeCall,
    recordUsage,
    spend,
    onUsage,
    spendPending,
  }
}

export type Credits = ReturnType<typeof createCredits>
