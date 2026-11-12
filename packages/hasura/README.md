# @kaperkunde/hasura

Everything an app needs to talk to Hasura, written once: signed JWTs, the
server and user clients, the GraphQL courier, hook helpers, and the
`kk-hasura` CLI that renders other packages' SQL and metadata templates into
your app. Nothing in here names a table, role or env var; the app passes them.

Peer dependencies (all optional, install what you import): `@apollo/client`
^3.13, `graphql` ^16, `graphql-ws` ^6, `react` ^19.

## `@kaperkunde/hasura/server`

| Export                                                                                                                            | What it gives                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `mintHasuraJwt({ userId, secret, role, allowedRoles?, claims?, ttlSeconds?, namespace? })`                                        | An HS256 token: `sub`, `exp`, and the `x-hasura-*` claims. Extra `claims` (a hat, a runner flag) are copied as given.                     |
| `parseJwtSecret(raw)`, `jwtExpiry(token)`                                                                                         | The key out of `HASURA_GRAPHQL_JWT_SECRET` (JSON or bare); `exp` of a token.                                                              |
| `createServerClient({ endpoint, adminSecret, role })`                                                                             | `{ request(req), execute(query, variables) }`: admin secret plus a named role, no cache. `execute` returns data or throws `HasuraError`.  |
| `forwardGraphql(request, { endpoint, token, role, onResult? })`                                                                   | The courier: carries a document under the caller's own token and role, returns Hasura's answer untouched. `onResult` is the tracing hook. |
| `hasuraHeaders`, `hasuraAdminHeaders`, `postGraphql`, `unexplainedRefusal`, `UNEXPLAINED`                                         | Building blocks of the above.                                                                                                             |
| `introspectSchema(opts)`, `createSchemaCache(ttl)`, `schemaIndex(schema, { intro?, outro? })`, `schemaText(schema, type?, opts?)` | The graph as one role sees it; a one-line-per-table index; one type; or all of it; a near-miss hint for a wrong name.                     |
| `verifyHookSecret(header, secret)`                                                                                                | Constant-time check of the shared secret on event and cron hooks; false when no secret is configured.                                     |
| `parseEventTrigger(body)`, `parseCronTrigger(body)`                                                                               | Typed reading of Hasura's event-trigger and cron payloads (`op`, `old`, `new`, `sessionVariables`, retries; `scheduledTime`, `payload`).  |

```ts
import {
  mintHasuraJwt,
  forwardGraphql,
  parseEventTrigger,
  verifyHookSecret,
} from "@kaperkunde/hasura/server"

const token = mintHasuraJwt({
  userId: session.user.id,
  secret: process.env.HASURA_JWT_KEY!,
  role: "user",
})
const { body } = await forwardGraphql(
  { query: "{ things { id } }" },
  { endpoint: process.env.HASURA_ENDPOINT!, token, role: "user" },
)

// POST /api/hooks/things
if (!verifyHookSecret(req.headers["x-hook-secret"], process.env.HOOK_SECRET)) {
  return new Response(null, { status: 401 })
}
const event = parseEventTrigger(await req.json())
```

## `@kaperkunde/hasura/client`

| Export                                                                    | What it gives                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createUserClient({ endpoint, wsEndpoint?, getToken, role, wsRetries? })` | An Apollo client over HTTP and graphql-ws. `getToken` is asked for every request and socket connect, and again `refreshBeforeMs` (default 60s) before the token expires; a changed token reconnects the socket. Returns `{ client, socket, tokens, onConnectionLost, dispose }`. |
| `getUserConnection(opts)`, `dropClient({ endpoint, role, cacheKey? })`    | The cached connection per endpoint + role + `cacheKey` (a user id), and letting go of one (closes the socket).                                                                                                                                                                   |
| `isConnectionLost(error)`                                                 | True for the socket's own `Socket closed` error, false for a failed HTTP request.                                                                                                                                                                                                |
| `createTokenSource({ getToken, refreshBeforeMs })`                        | The refresh-before-expiry timer on its own.                                                                                                                                                                                                                                      |
| `<WithHasura>`, `useHasuraConnection()`                                   | React provider taking the session's `token` and `refreshSession` as props. A lost socket draws your `renderLost({ onReturn, returning })` over the subtree; `onReturn` refreshes the session and rebuilds client and socket.                                                     |

```tsx
"use client"
import { WithHasura } from "@kaperkunde/hasura/client"

;<WithHasura
  endpoint={process.env.NEXT_PUBLIC_HASURA_ENDPOINT!}
  role="user"
  token={session.hasuraToken}
  cacheKey={session.userId}
  refreshSession={async () => (await refetchSession()).hasuraToken}
  renderLost={({ onReturn, returning }) => (
    <button onClick={onReturn} disabled={returning}>
      Reconnect
    </button>
  )}
  fallback={<SignIn />}
>
  {children}
</WithHasura>
```

## `kk-hasura`: packages that ship database objects

A package such as `@kaperkunde/credits` or `@kaperkunde/jobs` ships SQL and
metadata as templates under its own `hasura/` directory; `kk-hasura` renders
them into your app with your names.

```
hasura/manifest.json    { "name": "@kaperkunde/<pkg>", "vars": { "<var>": { "description", "default"? } } }
hasura/migrations/<13-digit version>_<snake_name>/up.sql, down.sql
hasura/metadata/tables/<name>.yaml.tmpl     (optional; the name is logical: the rendered file is named <schema>_<table>.yaml from its table.name)
hasura/metadata/functions.yaml.tmpl         (optional; a YAML list of function entries)
```

Templates use `{{var}}` and nothing else. An undeclared variable, a variable
with no value, and a stray `{{` are hard errors. Every package accepts the
standard variables `prefix`, `owner_table`, `owner_id_column`,
`owner_id_type`, `server_role`, `user_role` and `schema` (default `public`),
plus whatever its manifest declares.

The app's `kaperkunde.json`:

```json
{
  "hasura": {
    "database": "main",
    "migrationsDir": "hasura/migrations/main",
    "metadataDir": "hasura/metadata/databases/main"
  },
  "packages": {
    "@kaperkunde/credits": {
      "vars": {
        "prefix": "credit_",
        "owner_table": "users",
        "owner_id_column": "id",
        "owner_id_type": "text",
        "server_role": "server",
        "user_role": "user"
      },
      "adopted": []
    }
  }
}
```

```bash
kk-hasura sync            # render every not-yet-synced version, merge metadata, write kaperkunde.lock.json
kk-hasura sync --check    # exit 1 on drift or an edited synced file; writes nothing (use it in CI)
```

- A migration is written to `migrationsDir/<version>_<name>/` with the same
  version and name the package gave it. Versions are only ever added, never
  rewritten: if the package or your `vars` change what an already-synced
  version renders to, sync fails.
- `adopted` lists versions you already applied by hand (a live database with
  the objects under the same names): they are recorded in the lock, not
  written, and a package whose versions are all adopted writes no metadata.
- Table templates are written to `metadataDir/tables/<file>` and listed in
  `tables/tables.yaml` as `!include`; function entries are merged into
  `metadataDir/functions.yaml` by name, keeping your comments and other
  entries.
- `kaperkunde.lock.json` holds each package's version, the sha256 of every
  rendered migration and metadata file. `--check` fails if any synced file
  was edited or went missing, the lock is stale, or a new version is waiting.
- Role checks inside shipped SQL read `current_setting('hasura.user', true)`
  against the injected `server_role`.

The same engine is exported from `@kaperkunde/hasura/sync` (`runSync`,
`planSync`, `renderTemplate`, `loadPackage`) for tests and custom tooling.
