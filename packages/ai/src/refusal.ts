/**
 * What an app throws from `backend` or `beforeCall` to refuse a call before
 * anything is owed: a balance run out, a model nobody priced, a pause.
 * `fallbackWorthy` says whether the fallback model is worth asking; `until`
 * says when the refusal ends by itself (ISO), if it does.
 */
export class BackendRefusedError extends Error {
  readonly fallbackWorthy: boolean
  readonly reason: string
  readonly until?: string
  constructor(
    message: string,
    options: { reason?: string; fallbackWorthy?: boolean; until?: string } = {},
  ) {
    super(message)
    this.name = "BackendRefusedError"
    this.reason = options.reason ?? "refused"
    this.fallbackWorthy = options.fallbackWorthy ?? false
    this.until = options.until
  }
}
