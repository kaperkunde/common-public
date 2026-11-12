# @kaperkunde/config

The presets Kaperkunde's Next.js apps share, so a lint rule, a formatting
choice or a test setting changes in one place.

| Import                                  | Use it in                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `@kaperkunde/config/prettier`           | `"prettier": "@kaperkunde/config/prettier"` in `package.json`                        |
| `@kaperkunde/config/eslint`             | `eslint.config.mjs`: `export default nextConfig({ ignores, extra })`                 |
| `@kaperkunde/config/tsconfig/next.json` | `tsconfig.json`: `"extends"` (add the app's own `paths` and `include`)               |
| `@kaperkunde/config/vitest`             | `vitest.config.mts`: `appVitestConfig({ root: import.meta.dirname })`                |
| `@kaperkunde/config/playwright`         | `playwright.config.ts`: `defineConfig(appPlaywrightConfig({ ... }))`                 |
| `@kaperkunde/config/lint-staged`        | `lint-staged.config.mjs`: `export { default } from "@kaperkunde/config/lint-staged"` |

The Renovate preset lives in this repository at `renovate/default.json`:
`"extends": ["github>kaperkunde/common-public//renovate/default"]`.

A preinstalled Chromium is named by `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
(`PW_CHROMIUM_PATH` is still read).

ESLint presets need `eslint`, `eslint-config-next` 16 and
`eslint-config-prettier` installed in the app; the Vitest and Playwright
helpers need `vitest` and `@playwright/test`. All are optional peers, so an
app installs only what it uses.

## Deploy templates and the reusable checks workflow

`kk-scaffold` copies Dockerfile, hasura.Dockerfile, entrypoint and a Coolify
compose file into an app with the name substituted:

```bash
npx kk-scaffold --name aj                       # all four, into the current directory
npx kk-scaffold --name aj compose --set port=4000 --force
```

| Template            | Written to                   | What it is                                                                                                                                                                |
| ------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dockerfile`        | `deploy/Dockerfile`          | Next app: pnpm build stage (NEXT_PUBLIC_* as build args, placeholder env for the build), runtime stage, entrypoint                                                        |
| `hasura-dockerfile` | `deploy/hasura.Dockerfile`   | Hasura CLI with `hasura/migrations` and `hasura/metadata` copied in, for the `migrate` service                                                                            |
| `entrypoint`        | `deploy/entrypoint.sh`       | `better-auth migrate` (never wedges the app), then `next start`                                                                                                           |
| `compose`           | `docker-compose.coolify.yml` | postgres, hasura, a one-shot `migrate` (`depends_on: service_completed_successfully`) and the app, with Coolify magic variables; hook secret and Better Auth secret wired |

Variables (`--set key=value`): `name_upper`, `db`, `db_env`, `node_version`,
`pnpm_version`, `hasura_version`, `postgres_version`, `port`, `auth_config`,
`auth_dir`. Existing files are skipped unless `--force`. The templates are
untested against a Docker daemon here: build once before relying on them.

Reusable checks workflow (pnpm, `.nvmrc`, install, lint, format:check,
typecheck, test, build):

```yaml
jobs:
  checks:
    uses: kaperkunde/common-public/.github/workflows/checks.yml@main
    with:
      runner: ubuntu-latest # or a self-hosted runner label
```

Inputs: `runner`, `node-version-file`, `working-directory`, `run-lint`,
`run-format`, `run-typecheck`, `run-test`, `run-build`, `build-env`.
