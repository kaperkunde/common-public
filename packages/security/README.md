# @kaperkunde/security

The small server-side guards every Kaperkunde app had a copy of, each the
strongest of the copies it replaced.

| Export                                      | Does                                                                                  | From                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------ |
| `checkRateLimit`, `refundRateLimit`         | Fixed-window limit in memory, bounded, on `globalThis`, with `retryAfterMs`           | pcp + studyguild + lorespawner |
| `clientIpFromHeaders`                       | The client behind trusted proxies (CIDR list), read from the right of X-Forwarded-For | pcp                            |
| `safeCallbackUrl`                           | A post-login redirect that cannot leave the site (no `//`, `\`, control characters)   | studyguild                     |
| `isSameOrigin`                              | Sec-Fetch-Site, then Origin; neither is a refusal                                     | pcp                            |
| `safeEqual`, `matchesSecret`, `bearerToken` | Constant-time compare of hashed secrets; an unset secret never matches                | plekje                         |
| `createLinkTokens`                          | Signed, labelled, non-expiring subject tokens (unsubscribe links)                     | lorespawner                    |
| `isAdmin`                                   | Listed **and verified** address                                                       | lorespawner + pcp-gg           |
| `createSecretBox`, `redact`, `lastFour`     | AES-256-GCM under an env key, `v1:` versioned, label as AAD                           | lorespawner                    |
| `runBootChecks`, `secretProblem`            | Refuse to start in production on any problem; warn in development                     | plekje + studyguild            |

Pure Node: nothing here imports Next, so route handlers, server actions,
plain Node services and tests all use it the same way.

```ts
// instrumentation.ts
await runBootChecks([
  () =>
    secretProblem("BETTER_AUTH_SECRET", process.env.BETTER_AUTH_SECRET, {
      placeholders: ["dev-better-auth-secret-change-me-in-production"],
    }),
  () => getLegalDocsProblem({ docs: legalSite.docs }),
])
```
