# @kaperkunde/mcp

The one way an app's MCP tools are written, served and checked, and the
helpers for asking the owner by link. Built on `@modelcontextprotocol/server`
2 and zod 4 (peer dependencies, tested against 2.2.0 and 4.6.5).

| Import                    | What it gives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kaperkunde/mcp`         | `defineTool` (a zod input published as JSON Schema 2020-12, every object closed, every property described; all four annotations; aliases; `long`), `registerTool`/`registerTools`/`serveTool` (arguments checked before the run, outcome mapped, output checked), the outcomes `ok`, `toolError`, `needsOwner`, `passOn`, `toCallToolResult`, `metaKeys`; `validate` (the one JSON Schema check, bounded, with placeholders); `defineInnerTool` with `exactlyOne`/`atLeastOne`/`notTogether`; `writeOutput`, `written`, `notWritten`, `readOutput`, `answered`, `refused`; `annotationsFor` |
| `@kaperkunde/mcp/owner`   | `waitForOwner`, `OWNER_WAIT_MS`; `linkLabel`, `markdownLink`, `linkLastText`, `OWNER_LINK_RULE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `@kaperkunde/mcp/testing` | `catalogueProblems` (names, titles, descriptions — `descriptionStarts: USE_THIS_WHEN` — annotations, no passthrough, closed and described schemas, bounded integers), `markedExactly`                                                                                                                                                                                                                                                                                                                                                                                                       |

```ts
import {
  defineTool,
  registerTools,
  written,
  writeOutput,
} from "@kaperkunde/mcp"

const moveEvents = defineTool({
  name: "move_events",
  title: "Move events",
  description: "Use this when events happened somewhere else.",
  input: z.object({ ids: z.array(z.number().int().min(1)).describe("Which.") }),
  output: writeOutput({ moved: z.array(z.number()).describe("What moved.") }),
  annotations: annotationsFor({ write: true, destructive: true }),
  run: async ({ ids }, ctx) => written({ text: "Moved.", changed: refs, data }),
})

registerTools(server, [moveEvents], {
  app: caller, // ctx.app in every run
  meta: metaKeys("gg.pcp"), // where the error code goes in _meta
  expectedError: (e) => (e instanceof AppError ? e : undefined),
  log: (line) => requestLog.write(line),
})
```

## The rules it keeps

- **Arguments are checked before anything runs**, against the schema as
  published, and refused as a tool error (`isError`, code
  `invalid_arguments` in `_meta[meta.error]`) naming every problem, an
  unknown key and the keys the tool takes among them. Never dropped.
- **An answer is one of four kinds**: ok, a refusal with a code, a wait for
  the owner (`NEEDS_OWNER` as structuredContent, the link last in the
  text), or another tool's answer passed on. A thrown error is a refusal
  only when the app's `expectedError` recognises it; anything else is a
  fault, reported on the server and answered as `internal`.
- **A declared output is kept**: an answer that does not fit its output
  schema is a fault, never sent.
- **A write that changed nothing is `no_change`**, never success
  (`written`).
- **A long tool says it is working**: progress to a client that asked, and
  past its patience an honest "still going, it lands at X" while the run
  carries on (`long: { stillGoing }`). A route answers such a call on a
  stream (`wantsStream`).

The app keeps what is its own: its error class, its log, its scopes and
which connection sees which tool, the reasons and links it asks the owner
for (`needsOwnerSchema`, `ownerLinkIn`), its placeholders, and its route.

## Bad arguments: `invalidArgs`

By default arguments that do not fit come back as a tool result with `isError`,
which an assistant reads and retries. Set `invalidArgs: "protocol-error"` on a
tool (or on `registerTools`' options) to answer them as a JSON-RPC -32602
instead, whose message and `data: { tool, issues }` name every path, the
unknown keys and the keys allowed there (`issuesOf`, `invalidArgumentsError`).
`McpServer.registerTool` turns anything a handler throws into a tool result, so
any tool in this mode makes `registerTools` serve `tools/list` and `tools/call`
itself on the server (a single `registerTool` of such a tool throws, pointing
at `registerTools`).

## `@kaperkunde/mcp/next`: the route plumbing

For an app whose MCP route sits behind Better Auth's OAuth provider. Scope
names, audiences, tool names and words are yours. Peers (all optional, only
for this subpath): `@kaperkunde/auth`, `@kaperkunde/security`, `jose`.

| Export                                                                                                                                        | What it gives                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toWebRequest`, `sendWebResponse`, `headerPairs`, `noStore`                                                                                   | The Node bridge for a pages-router API route (Next hands `IncomingMessage`/`ServerResponse` with the body parsed; chunks are flushed past compression so progress streams). An app-router route is handed web `Request`/`Response` already; `noStore` adds the header.                                                                                                                                                                                                      |
| `createBearerVerifier({ verifyToken, loadConsent })`                                                                                          | `Authorization` header to `{ userId, clientId, scopes }` or undefined: token verified, then the consent row asked again on every request and the scopes narrowed to it, so Disconnect takes effect at once.                                                                                                                                                                                                                                                                 |
| `jwksVerifier({ jwks, issuer, audience })`                                                                                                    | A `verifyToken` against the provider's key set (read from its own table, `auth.api.getJwks()`, not fetched from your public URL), via `jose`, kept a minute.                                                                                                                                                                                                                                                                                                                |
| `createDoor({ verifyBearer, resolve, resourceMetadataUrl, scopes, rateLimit, buckets?, classifier? })`                                        | `admit(header, body)`, `admitNode(req, res)` (pages) and `admitWeb(request)` (app router): who is asking (verified, walked to your caller by `resolve`, held to your gate), then limited per person in two buckets, reads and writes (`DEFAULT_BUCKETS` 600 and 120 a minute). Refusals carry the `WWW-Authenticate` challenge and the 429 carries `Retry-After` and `retryAfterSeconds`, `bucket`, `limit`. `rateLimit` fits `checkRateLimit` from `@kaperkunde/security`. |
| `requestKind`, `rpcIdOf`, `tooManyBody`                                                                                                       | The pure sorting and refusal shape. Tools named `list_`, `get_`, `read_` or in `classifier.readTools` read; unknown tools count as writes.                                                                                                                                                                                                                                                                                                                                  |
| `protectedResourceMetadata`, `mcpUrl`, `scopesOf`, `describeScopes`, `webAddress`, `isAuthorizeQuery`, `resumeAuthorizeUrl`, `consentRequest` | The RFC 9728 document and the consent and login screens' helpers.                                                                                                                                                                                                                                                                                                                                                                                                           |

```ts
const door = createDoor({
  verifyBearer: createBearerVerifier({
    verifyToken: jwksVerifier({
      jwks: () => auth.api.getJwks(),
      issuer,
      audience: mcpResource,
    }),
    loadConsent: async (userId, clientId) =>
      (await findConsent(userId, clientId))?.scopes ?? null,
  }),
  resolve: async ({ userId }) => {
    const user = await userFor(userId)
    return user ? { ok: true, caller: user, rateKey: user.id } : undefined
  },
  resourceMetadataUrl,
  scopes: ["app:read", "app:write"],
  rateLimit: (key, limit) => checkRateLimit(key, limit),
})
// app router: const admitted = await door.admitWeb(request); if ("response" in admitted) return admitted.response
```
