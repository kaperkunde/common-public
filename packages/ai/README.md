# @kaperkunde/ai

Model calls for Kaperkunde's apps, written once. A provider and config you hand
values to, `runModel` with admission and usage hooks, fallback models, prompt
cache marks, a tracing sink, generic model roles, backend choice (the
deployment's model or a person's own), speech synthesis adapters, and scripted
fakes for tests. It holds no ledger, billing, pause or job code: the app owns
what is decided (admission, the books), the package owns the mechanics. Nothing
in it names an app, a table, a role or an env var.

Peer dependencies: `ai` ^7, `@ai-sdk/anthropic` ^4, `@ai-sdk/openai-compatible`
^3, `@kaperkunde/security` (for guarded fetches to a person's own endpoint).

## `@kaperkunde/ai`

| Export                                                                                                                                                                                    | What it gives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `defineLlmConfig({ baseURL, apiKey, provider, models, toolChoice })`                                                                                                                      | The deployment's model config from values the app read itself. Never throws; `enabled: false` when half-set. Also `parseModels`, `llmProviderOf`, `llmConfigProblem`, `modelFor`, `LlmOffError`.                                                                                                                                                                                                                                                                                                                         |
| `createRunModel<C>(hooks)`                                                                                                                                                                | Returns `runModel(run)`: resolves the back end, builds the provider, marks the prompt cache, runs `generateText` (or `streamText` with `onStream`, same answer shape), asks `fallbackModel` once on the provider's trouble, and calls your hooks. `C` is your own context type (user id, purpose...), passed through untouched.                                                                                                                                                                                          |
| hook `backend`                                                                                                                                                                            | Which back end serves (`ResolvedBackend`): one fixed value, or a function that may throw a `BackendRefusedError` before anything is owed.                                                                                                                                                                                                                                                                                                                                                                                |
| hook `beforeCall(ctx)`                                                                                                                                                                    | Admission, after the back end is chosen: `{ context, model, attempt, backend }`. Throw to refuse; a refused call reaches no `onUsage`.                                                                                                                                                                                                                                                                                                                                                                                   |
| hook `onUsage(row)`                                                                                                                                                                       | Called in a `finally` for every attempt: `{ kind: "llm", userId, purpose, scopeId, jobId, activity, context, model, source, attempt, usage, requests, call, startedAt, ms, failure? }`. `requests` is one entry per request (`inputTokens, outputTokens, cachedTokens, cacheWriteTokens, cacheWrite1hTokens, reasoningTokens, inferenceGeo, speed, serviceTier, dimensions?`) as the provider billed it; `call` adds call-level totals. What it returns (a row id) becomes the trace's `usageRef`. Never fails the call. |
| hook `trace(call, { context, usageRef })`                                                                                                                                                 | Injected trace sink: a clipped `TraceCall` (instructions, messages, each step's tool calls and results, usage, error).                                                                                                                                                                                                                                                                                                                                                                                                   |
| `chatModel`, `markCachePrefix`, `fallbackWorthy`, `requestsOf`                                                                                                                            | The pieces on their own. Anthropic gets cache marks on the instructions, the first message, shared instructions and (for tool loops) the conversation end; other providers get the same ordering unmarked.                                                                                                                                                                                                                                                                                                               |
| `modelRoles({ writer: [], checker: ["haiku", "sonnet"] })`                                                                                                                                | Roles are yours. `modelForRole(role, { ownerModel, settings, offered })` picks the admin's row, else the first offered model of a family, else the owner's; with a fallback. `offeredModels`.                                                                                                                                                                                                                                                                                                                            |
| `backendSequence`, `orderFor`, `chooseBackend`, `finalRefusal`, `ownVerdict`, `deploymentOffers`, `modelForPlayer`, `pickedModel`, `pickableModels`, `aiAvailability`, `ownEndpointShape` | Pure rules for "the deployment's model or the person's own, in their order, falling to the other". Sources are `deployment` and `own`; orders `own_then_deployment`, `deployment_then_own`, `own_only`, `deployment_only`.                                                                                                                                                                                                                                                                                               |
| `createOwnBackend({ baseUrl, sealedKey, openKey, allowPrivate })`, `guardedFetch`, `resolveByOrder`                                                                                       | A person's own endpoint as a `ResolvedBackend`: the address checked, the key opened by _your_ `openKey` (sealing stays with you; see `@kaperkunde/security` `createSecretBox`), every request through `publicFetch` so a name cannot be pointed at your network.                                                                                                                                                                                                                                                         |

```ts
import {
  createRunModel,
  BackendRefusedError,
  defineLlmConfig,
} from "@kaperkunde/ai"

const config = defineLlmConfig({
  baseURL: process.env.MY_LLM_URL,
  apiKey: process.env.MY_LLM_KEY,
  models: process.env.MY_LLM_MODELS,
})

export const runModel = createRunModel<{ userId: string; purpose: string }>({
  backend: ({ context }) => resolveFor(context.userId), // your order, your key box
  beforeCall: async ({ context, backend }) => {
    if (backend.source === "deployment" && !(await hasCredit(context.userId))) {
      throw new BackendRefusedError("Out of credit.", { reason: "out" })
    }
  },
  onUsage: async (row) => {
    if (row.kind === "llm") return (await recordUsage(row)).id // becomes trace usageRef
  },
  trace: (call, { context }) => saveTrace(context.userId, call),
})

const result = await runModel({
  context: { userId, purpose: "chat" },
  model: config.defaultModel,
  fallbackModel: "smaller-model",
  instructions: "Be brief.",
  messages: [{ role: "user", content: "Hi" }],
  tools: {},
})
```

## `@kaperkunde/ai/speech`

`Speech` is `synthesize({ text, voice, format }) -> { audio: Uint8Array, mime, chars, seconds? }`.
Adapters are plain `fetch`; endpoint, key, model and voice are yours.

| Export                                                             | What it gives                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `openaiSpeech({ apiKey, model, baseURL?, instructions?, speed? })` | OpenAI `/audio/speech` or any server that speaks it. mp3, wav, opus, aac, flac. |
| `elevenlabsSpeech({ apiKey, model?, voiceSettings?, baseURL? })`   | ElevenLabs text-to-speech; `voice` is the voice id. mp3 only.                   |
| `fakeSpeech({ failWith?, charsPerSecond? })`                       | A tiny valid silent mp3 or wav; no network.                                     |

Every adapter takes `onUsage` (and `context`), called in a `finally` with
`{ kind: "tts_chars", units (= chars), userId, purpose, scopeId, jobId, activity, source, adapter, model, voice, seconds?, startedAt, ms, failure? }` (pass the accounting fields on `synthesize`; adapters also take `beforeCall`):
the same shape family as `runModel`'s `onUsage` (`UsageRow` is the union).

## `@kaperkunde/ai/testing`

`createFakeLlm({ script, replies, usage, failFirst, models })` starts a real
HTTP server speaking OpenAI-compatible chat completions (streaming and tool
calls included) on a free port. `script(request)` decides each answer from the
conversation (`request.lastUserText`, `.tools`, `.answeringATool`,
`.lastToolText`, `.called(name)`, `.takes(tool, arg)`); `replies` are handed out
in order; every reply reports the same usage. `fake.baseURL` is the base URL,
`fake.seen()` what it was sent, `fake.close()` stops it. `fakeSpeech` is
re-exported.

```ts
const llm = await createFakeLlm({
  script: (r) =>
    r.lastUserText.includes("hi") ? { text: "Hello." } : undefined,
})
const runModel = createRunModel({
  backend: { source: "deployment", baseURL: llm.baseURL, toolChoice: "auto" },
})
```
