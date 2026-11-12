import { createHash } from "node:crypto"

import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"

import { LlmOffError, type LlmProvider, type ToolChoiceMode } from "./config"

/**
 * What a call is made with, once a back end has been chosen. `source` is the
 * app's own label for who pays ("hosted", "own", ...).
 */
export type ResolvedBackend = {
  source: string
  /** The model to run there, when it is not the one asked for. */
  model?: string
  baseURL: string
  apiKey?: string
  toolChoice: ToolChoiceMode
  /** The protocol it is spoken to in; unset is OpenAI-compatible. */
  provider?: LlmProvider
  /** The fetch this endpoint is reached with (see `guardedFetch`). */
  fetch?: typeof fetch
  /** Names the OpenAI-compatible provider in the SDK; default `openai-compatible`. */
  providerName?: string
}

type Provider =
  | {
      kind: "openai-compatible"
      provider: ReturnType<typeof createOpenAICompatible>
    }
  | { kind: "anthropic"; provider: ReturnType<typeof createAnthropic> }

/**
 * Providers built so far, by where they point and a hash of the key they
 * carry (never the key), bounded so a key per user cannot grow it for ever.
 * On globalThis so a dev-server module reload does not build them all again.
 */
const MAX_PROVIDERS = 200
const store = globalThis as typeof globalThis & {
  __kaperkundeAiProviders?: Map<string, Provider>
}
const providers = store.__kaperkundeAiProviders ?? new Map<string, Provider>()
store.__kaperkundeAiProviders = providers

const keyOf = (backend: ResolvedBackend) =>
  [
    backend.source,
    backend.provider ?? "openai-compatible",
    backend.baseURL,
    backend.providerName ?? "",
    createHash("sha256")
      .update(backend.apiKey ?? "")
      .digest("base64url"),
  ].join("|")

const providerFor = (backend: ResolvedBackend): Provider =>
  backend.provider === "anthropic"
    ? {
        kind: "anthropic",
        provider: createAnthropic({
          baseURL: backend.baseURL,
          apiKey: backend.apiKey,
          fetch: backend.fetch,
        }),
      }
    : {
        kind: "openai-compatible",
        provider: createOpenAICompatible({
          name: backend.providerName ?? "openai-compatible",
          baseURL: backend.baseURL,
          apiKey: backend.apiKey,
          // The ledger is the whole cost control: a provider that answers
          // without a usage block would read as free.
          includeUsage: true,
          fetch: backend.fetch,
        }),
      }

/** The model a call runs against, on the back end that was chosen for it. */
export const chatModel = (
  modelId: string,
  backend: Pick<
    ResolvedBackend,
    "source" | "baseURL" | "apiKey" | "fetch" | "provider" | "providerName"
  >,
): LanguageModel => {
  if (!backend.baseURL) throw new LlmOffError()
  const key = keyOf(backend as ResolvedBackend)
  let provider = providers.get(key)
  if (!provider) {
    provider = providerFor(backend as ResolvedBackend)
    if (providers.size >= MAX_PROVIDERS) {
      const oldest = providers.keys().next().value
      if (oldest !== undefined) providers.delete(oldest)
    }
    providers.set(key, provider)
  }
  return provider.kind === "anthropic"
    ? provider.provider.languageModel(modelId)
    : provider.provider.chatModel(modelId)
}

/** For tests: how many providers are cached. */
export const providerCacheSize = () => providers.size
