---
"@kaperkunde/tokens": patch
---

Teach the client the Token Center's provider refusals: `provider_out_of_credit` (503, with
`provider` and `model` in the detail; nothing charged, do not retry until an admin tops up),
`provider_rate_limited` (429, with `Retry-After`) and `provider_overloaded` (503, retryable), plus
`TokenCenterError.retryable` and `RETRYABLE_ERROR_CODES`. `SpeechResult.voiceFallback` and `voiceFallbackFromHeaders` expose
the `x-token-voice-fallback` header. The stub simulates all of them through `fail` (env
`TOKENS_STUB_FAIL`, `POST /stub/mode`, the `x-stub-fail` header), with a second voice for the speech fallback.
