/** How the tool call an agent has to make is asked for. */
export type ToolChoiceMode = "required" | "auto"

/**
 * Which protocol a model is spoken to in: Anthropic's own Messages API, the
 * only way to its prompt cache, or the OpenAI-compatible chat completions
 * everything else (and Anthropic's compatibility endpoint) speaks.
 */
export type LlmProvider = "anthropic" | "openai-compatible"

export type LlmConfig = {
  /** Whether there is a model at all. */
  enabled: boolean
  baseURL: string
  apiKey?: string
  provider: LlmProvider
  /** What may be asked for; the first is the default. */
  models: string[]
  defaultModel: string
  /**
   * `required` makes the model answer with a tool call. Some servers refuse
   * to be told (Ollama ignores it), so `auto` asks for the same in the prompt.
   */
  toolChoice: ToolChoiceMode
}

/** What the app hands in: the values, read by the app from whatever names it chose. */
export type LlmConfigInput = {
  baseURL?: string | null
  apiKey?: string | null
  /** `anthropic`, `openai` or `openai-compatible`; unset reads it off the base URL. */
  provider?: string | null
  /** A comma-separated list or an array. */
  models?: string | readonly string[] | null
  /** `auto` or `required` (the default). */
  toolChoice?: string | null
}

/** A comma-separated list, trimmed, blanks dropped, order kept. */
export const parseModels = (raw?: string | readonly string[] | null) =>
  (typeof raw === "string" ? raw.split(",") : [...(raw ?? [])])
    .map((model) => model.trim())
    .filter(Boolean)

/**
 * The protocol a model is spoken to in. `provider` says it outright; unset, a
 * base on Anthropic's own host is Anthropic's API and anything else is
 * OpenAI-compatible.
 */
export const llmProviderOf = (
  provider: string | null | undefined,
  baseURL: string,
): LlmProvider => {
  const named = (provider ?? "").trim().toLowerCase()
  if (named === "anthropic") return "anthropic"
  if (named === "openai" || named === "openai-compatible") {
    return "openai-compatible"
  }
  try {
    return new URL(baseURL).hostname.toLowerCase() === "api.anthropic.com"
      ? "anthropic"
      : "openai-compatible"
  } catch {
    return "openai-compatible"
  }
}

/**
 * The deployment's model configuration. Never throws: with no base URL or no
 * models it reads as `enabled: false`, which callers answer in words.
 */
export const defineLlmConfig = (input: LlmConfigInput): LlmConfig => {
  const baseURL = (input.baseURL ?? "").trim().replace(/\/+$/, "")
  const models = parseModels(input.models)
  return {
    enabled: Boolean(baseURL) && models.length > 0,
    baseURL,
    apiKey: input.apiKey?.trim() || undefined,
    provider: llmProviderOf(input.provider, baseURL),
    models,
    defaultModel: models[0] ?? "",
    toolChoice:
      input.toolChoice?.trim().toLowerCase() === "auto" ? "auto" : "required",
  }
}

/** Why a configuration is off, or undefined when it is on. */
export const llmConfigProblem = (
  config: LlmConfig,
  names: { baseURL: string; models: string } = {
    baseURL: "the base URL",
    models: "the model list",
  },
) => {
  if (config.enabled) return undefined
  if (config.baseURL && config.models.length === 0) {
    return `A model endpoint is set but ${names.models} names no model, so there is nothing to ask.`
  }
  if (!config.baseURL && config.models.length > 0) {
    return `Models are named but ${names.baseURL} is unset, so there is nowhere to ask.`
  }
  return LLM_OFF_MESSAGE
}

/** What a caller says when there is no model to ask. */
export const LLM_OFF_MESSAGE =
  "No language model is configured, so the AI cannot act yet."

/** What every caller throws when there is no model to ask. */
export class LlmOffError extends Error {
  constructor(message = LLM_OFF_MESSAGE) {
    super(message)
    this.name = "LlmOffError"
  }
}

/** The model to use: the one chosen if still offered, else the default. */
export const modelFor = (
  chosen: string | null | undefined,
  config: Pick<LlmConfig, "models" | "defaultModel">,
) => (chosen && config.models.includes(chosen) ? chosen : config.defaultModel)
