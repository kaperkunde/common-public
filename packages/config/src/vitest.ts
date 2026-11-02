import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig, type ViteUserConfig } from "vitest/config"

const stub = fileURLToPath(new URL("../server-only-stub.mjs", import.meta.url))

export type AppVitestOptions = {
  /** The app's root directory; `@` resolves to it. Usually `import.meta.dirname`. */
  root: string
  /** Test files, relative to `root`. Defaults to `lib` and everything else under it. */
  include?: string[]
  /** Merged over the preset last. */
  overrides?: ViteUserConfig
}

/**
 * Unit tests next to the code, in Node, with `@` pointing at the app root and
 * `server-only` stubbed so server modules can be imported outside Next.
 *
 *   // vitest.config.mts
 *   import { appVitestConfig } from "@kaperkunde/config/vitest"
 *   export default appVitestConfig({ root: import.meta.dirname })
 */
export function appVitestConfig({
  root,
  include = ["**/*.test.{ts,tsx}"],
  overrides = {},
}: AppVitestOptions): ViteUserConfig {
  return defineConfig({
    ...overrides,
    resolve: {
      ...overrides.resolve,
      alias: {
        "@": root,
        "server-only": stub,
        ...(overrides.resolve?.alias as Record<string, string> | undefined),
      },
    },
    test: {
      include,
      exclude: ["**/node_modules/**", "**/.next/**", "e2e/**", "tests/**"],
      environment: "node",
      ...overrides.test,
    },
  })
}

/** The path of the `server-only` stub, for a config built by hand. */
export const serverOnlyStub = path.resolve(stub)
