import type { ModelMessage, SystemModelMessage } from "ai"

import type { LlmProvider } from "./config"

/**
 * Which part of a prompt a provider may keep in its cache.
 *
 * The contract for whoever builds a prompt: **the stable material is the first
 * message, and the turn comes after it.** On Anthropic's own API (the one
 * provider that wants to be told) the instructions and that first message are
 * marked as where the cached prefix ends. Other providers get the prompt
 * unmarked: OpenAI-compatible servers that cache do it by prefix, which the
 * same ordering serves.
 *
 * - `conversation` adds a mark at the end of whatever is sent (Anthropic's
 *   automatic caching) for a tool loop over a growing conversation.
 * - `shared` is instructions the same for every call of their kind; they go
 *   first as a system block with a mark of their own.
 *
 * At most four marks are spent, which is all Anthropic allows.
 */
export const CACHE_MARK = {
  anthropic: { cacheControl: { type: "ephemeral" as const } },
}

type ProviderOptions = SystemModelMessage["providerOptions"]

export type CacheAsk = {
  shared?: string
  conversation?: boolean
  providerOptions?: ProviderOptions
}

/** The instructions as one text, for a provider that takes no mark, and for the trace. */
export const wholeInstructions = (instructions: string, shared?: string) =>
  shared ? `${shared}\n\n${instructions}` : instructions

export const markCachePrefix = (
  provider: LlmProvider | undefined,
  instructions: string,
  messages: ModelMessage[],
  ask: CacheAsk = {},
): {
  instructions: string | SystemModelMessage | SystemModelMessage[]
  messages: ModelMessage[]
  providerOptions?: ProviderOptions
} => {
  if (provider !== "anthropic") {
    return {
      instructions: wholeInstructions(instructions, ask.shared),
      messages,
      providerOptions: ask.providerOptions,
    }
  }
  const system: SystemModelMessage = {
    role: "system",
    content: instructions,
    providerOptions: CACHE_MARK,
  }
  const marked: string | SystemModelMessage | SystemModelMessage[] = ask.shared
    ? [
        { role: "system", content: ask.shared, providerOptions: CACHE_MARK },
        system,
      ]
    : system
  const [first, ...rest] = messages
  const firstMarked = first
    ? ({
        ...first,
        providerOptions: { ...first.providerOptions, ...CACHE_MARK },
      } as ModelMessage)
    : undefined
  const own = ask.providerOptions ?? {}
  return {
    instructions: marked,
    messages: firstMarked ? [firstMarked, ...rest] : messages,
    providerOptions: ask.conversation
      ? { ...own, anthropic: { ...own.anthropic, ...CACHE_MARK.anthropic } }
      : ask.providerOptions,
  }
}
