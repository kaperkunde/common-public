import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"
import prettier from "eslint-config-prettier"

/** What no app lints: build output, generated code, test artifacts. */
export const DEFAULT_IGNORES = [
  ".next/**",
  "out/**",
  "build/**",
  "dist/**",
  "coverage/**",
  "next-env.d.ts",
  "lib/generated/**",
  "e2e/.artifacts/**",
  "e2e/.auth/**",
  "e2e/.state/**",
  "playwright-report/**",
  "test-results/**",
]

/**
 * The flat ESLint config for a Next.js 16 app: Next's core web vitals and
 * TypeScript rules, Prettier's formatting rules turned off (Prettier formats),
 * no semicolons, and unused variables an error unless they start with `_`.
 *
 *   // eslint.config.mjs
 *   import { nextConfig } from "@kaperkunde/config/eslint"
 *   export default nextConfig({ ignores: ["sandbox/**"], extra: [...] })
 *
 * `extra` is appended last, so an app's own rules (pcp's boundaries, say)
 * win over the preset.
 */
export function nextConfig({ ignores = [], extra = [] } = {}) {
  return defineConfig([
    ...nextVitals,
    ...nextTs,
    prettier,
    {
      rules: {
        semi: ["error", "never"],
        "@typescript-eslint/no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            ignoreRestSiblings: true,
          },
        ],
      },
    },
    ...extra,
    globalIgnores([...DEFAULT_IGNORES, ...ignores]),
  ])
}

export default nextConfig()
