---
"@kaperkunde/ai": patch
---

Meter a failed attempt: `onUsage` now reports every request the provider finished before a call threw (a provider error, timeout, abort or a stream cut off mid-tool-loop), with `failed: true` and `failureKind`, instead of `requests: []`. A streamed call that times out or is aborted now throws instead of returning a partial answer, and an abort or timeout error no longer breaks the failure report when its message is read-only.
