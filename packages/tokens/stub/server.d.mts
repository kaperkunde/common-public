export type StubOptions = {
  /** 0 = any free port. Default `TOKENS_STUB_PORT` or 4100. */
  port?: number
  /** If set, the only app key accepted; otherwise any non-empty key is. */
  key?: string
  /** Where signed webhooks are POSTed; none when unset. */
  webhookUrl?: string
  /** HMAC secret for `token-signature`. Default `whsec_stub`. */
  webhookSecret?: string
  /** Base URLs (`…/v1`) provider calls are forwarded to; canned answers when unset. */
  upstream?: { anthropic?: string; openai?: string; own?: string }
  /** Extra model ids offered on the chat-completions protocol. */
  extraModels?: string[] | string
  /** Purchased balance a new user starts with, micros. Default 5,000,000. */
  startMicros?: number
  /** Fee on the purchased portion, basis points. Default 2000. */
  feeBps?: number
  unitOne?: string
  unitMany?: string
  /** The canned assistant text. */
  reply?: string
}

export type Stub = {
  url: string
  port: number
  /** Forget every user, call and purchase. */
  reset(): void
  close(): Promise<void>
}

export function startStub(options?: StubOptions): Promise<Stub>
