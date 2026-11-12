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
  const first = <KEY extends "inferenceGeo" | "speed" | "serviceTier">(key: KEY) =>
    requests.find((request) => request[key])?.[key] ?? null
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
export type Admission = { balance?: CreditBalance; source: "deployment" | "own" }

export const createCredits = (config: CreditsConfig) => {
  const store = createStore(config.db, config.names)
  const unit = config.unit ?? DEFAULT_UNIT
  const log =
    config.log ?? ((message: string, error: unknown) => console.error(message, error))

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
  const admit = async (
    userId: string,
    context: { model: string; source?: "deployment" | "own" },
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
              (error) => log("A user could not be told of their key's limit", error),
            )
          }
          return fail("OWN_LIMIT", message)
        }
      }
      return ok({ source: "own" as const })
    }
    if (!(await store.priceNow(context.model))) {
      return fail(
        "UNPRICED",
        `${context.model} has no price set here yet, so it cannot be used. Choose another model.`,
      )
    }
    const balance = await store.admit(userId)
    if (admitted(balance)) return ok({ balance, source: "deployment" as const })
    const message = outOfCreditsMessage(unit)
    await tellOut(userId, message)
    return fail("OUT_OF_CREDITS", message)
  }

  /** `admit` for a hook that refuses by throwing `CreditsRefusedError`. */
  const beforeCall = async (context: {
    userId: string
    model: string
    source?: "deployment" | "own"
  }) => {
    const verdict = await admit(context.userId, context)
    if (!verdict.ok) throw new CreditsRefusedError(verdict.code, verdict.message)
    return verdict
  }

  /** Writes a call to the ledger, unconverted (or at no credits, for the user's own key). */
  const recordUsage = (input: UsageInput) => store.insertUsage(ledgerRowOf(input))

  /** Converts one ledger row into credits and takes them from its user. Idempotent. */
  const spend = (usageId: number) => store.spend(usageId)

  /**
   * The ledger and the spend in one, for a hook's `onUsage`: written, then (unless it ran on
   * the user's own key) converted and taken, then `afterSpend` asked without waiting on it.
   */
  const onUsage = async (input: UsageInput): Promise<UsageRow> => {
    const row = await recordUsage(input)
    if (input.source === "own") return row
    const spent = await spend(row.id)
    if (config.afterSpend) {
      Promise.resolve()
        .then(() => config.afterSpend?.(input.userId))
        .catch((error) => log("Auto-refill could not be asked about", error))
    }
    return spent
  }

  return { store, unit, admit, beforeCall, recordUsage, spend, onUsage }
}

export type Credits = ReturnType<typeof createCredits>
