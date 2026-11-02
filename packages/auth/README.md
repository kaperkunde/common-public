# @kaperkunde/auth

Better Auth as the OAuth 2.1 authorization server for an app's MCP
connector, plus the rules and words the sign-in forms share.

| Import                    | What it gives                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kaperkunde/auth/preset` | `mcpAuthPreset({ urls, scopes })` to spread into `betterAuth({…})`: jwt (its `/token` closed, no set-auth-jwt header), mcp (code + refresh only, open registration, an hour's access token), cimd, and the production rate limit with room for the OAuth endpoints. `discoveryRoute(auth.handler)` for the root `.well-known` routes                                                                                                                                            |
| `@kaperkunde/auth`        | `mcpUrls` (issuer, resource, JWKS over loopback, resource metadata); `parseScopeList`, `effectiveScopes` (token ∩ live consent, null once disconnected); `bearerChallenge`, `mcpAuthError`, `withCors`, `bearerTokenFrom`, `calledToolNames`; `hashOpaqueToken` + `opaqueTokenClaims` (refuses revoked, expired, DPoP-bound, disabled-client, expired-session and other-resource tokens); `validatePassword`, `withResetPasswordEmail`, `authErrorMessage`, `oauthRedirectFrom` |

The app keeps what is its own: the database adapter, its hooks, the scope
names and their descriptions, and the lookups (`oauthConsent`,
`oauthAccessToken`) through its own client, whose rows these functions judge.
