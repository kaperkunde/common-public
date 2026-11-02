# Working in this repo

Shared packages for Kaperkunde's apps, published as `@kaperkunde/*` on npm.
Read README.md for the package list and the public-or-private rule.

## Rules

- **Public by default.** Nothing here names a host, a secret, a runner or a
  private service's contract; anything app-specific is a parameter. When in
  doubt, read the rule in README.md before adding code.
- **One job per package**, ESM only, built with tsdown to `dist/` (JS +
  `.d.ts`), with an `exports` map. Server and React code are separate
  subpath exports; a React entry starts with `"use client"` only where it
  must. `"sideEffects": false` unless a file really has one.
- **Peer dependencies, never bundled**: react, next, better-auth,
  `@modelcontextprotocol/server`, zod, nodemailer, prisma. State the range
  the package is tested against.
- **Every change to a package carries a changeset** (`pnpm changeset`). A
  breaking change is a major, with a migration note in the changeset; the apps
  take majors by hand.
- **Expected failures are returned, not thrown**: `Result<T>` from
  `@kaperkunde/next-kit`. Throw only for bugs and for failures on the way
  (network, database).
- **Tests sit next to the code** (`src/**/*.test.ts`) and are the strongest
  of the copies a package replaced. A package without tests is not released.

## Before pushing

```bash
pnpm lint && pnpm format:check && pnpm build && pnpm typecheck && pnpm test
```

Toolchain: Node 24, pnpm 10.33, TypeScript 5.9, Vitest 5, ESLint 9 flat,
Prettier 3. `minimumReleaseAge` keeps new third-party releases out for a day.
