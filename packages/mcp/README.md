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
