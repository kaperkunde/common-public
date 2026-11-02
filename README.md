# Kaperkunde common (public)

The shared code behind Kaperkunde's apps (Lore Spawner, PCP, pcp.gg, plek.je,
Study Guild), published to npm as `@kaperkunde/*`. Each package is one job,
written once, tested here, and kept up to date in every app by Renovate.

## Packages

None are published yet. Each lands here with its own README:

| Package                      | What it does                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `@kaperkunde/config`         | ESLint, Prettier, tsconfig, Vitest and Playwright presets; the Renovate preset            |
| `@kaperkunde/legal`          | Rendering and pinning the `kaperkunde/legal` documents                                    |
| `@kaperkunde/pcpgg-protocol` | pcp.gg's tunnel protocol and connector                                                    |
| `@kaperkunde/security`       | Rate limits, client IP, safe redirects, secret boxes, boot checks, public-address fetches |
| `@kaperkunde/next-kit`       | `Result`, `ActionState`, site and operator helpers, Prisma, the scheduler                 |
| `@kaperkunde/mail`           | SMTP transport, the themed email template, Mailpit test helpers                           |
| `@kaperkunde/auth`           | The Better Auth MCP preset, OAuth discovery, route auth                                   |
| `@kaperkunde/mcp`            | The MCP tool factory and the owner-by-link helpers                                        |
| `@kaperkunde/stripe`         | The checked Stripe webhook core                                                           |
| `@kaperkunde/ui`             | Design tokens and primitives for the Tailwind apps                                        |

## Public or private

This repository is public and MIT. A component goes to the private
`kaperkunde/common` instead only if it:

1. reveals private product internals (roadmap, pricing logic, a private
   service's API contract);
2. names internal infrastructure (hostnames, deploy topology, self-hosted
   runners); or
3. depends on secrecy for its value (anti-abuse heuristics, sign-up
   allowlists).

Everything else is public, even when only private apps use it. App specifics
(scopes, themes, env-var prefixes) are passed in as parameters, so a generic
package exposes nothing about the app using it.

## Working here

```bash
pnpm install
pnpm lint && pnpm format:check && pnpm build && pnpm typecheck && pnpm test
pnpm changeset        # in every pull request that changes a package
```

Releases are automatic: merging to `main` opens or updates a "Version
packages" pull request; merging that publishes to npm.
