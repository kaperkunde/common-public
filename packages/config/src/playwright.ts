import type { PlaywrightTestConfig } from "@playwright/test"

/**
 * Where a preinstalled Chromium is, when the machine has one (cloud sandboxes
 * do, and cannot download Playwright's). One variable everywhere:
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE. The old per-app names are still read.
 */
export function chromiumExecutable(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value =
    env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? env.PW_CHROMIUM_PATH ?? undefined
  return value?.trim() || undefined
}

/**
 * The base every app's Playwright config shares: specs in `e2e/tests`,
 * artifacts in `e2e/.artifacts`, one worker (specs build on each other's
 * state), list and HTML reporters, traces and screenshots kept on failure,
 * and a preinstalled Chromium when there is one. The app's own settings are
 * spread over it; `use` is merged one level down.
 *
 *   // playwright.config.ts
 *   import { defineConfig } from "@playwright/test"
 *   import { appPlaywrightConfig } from "@kaperkunde/config/playwright"
 *   export default defineConfig(appPlaywrightConfig({ projects: [...] }))
 */
export function appPlaywrightConfig(
  overrides: PlaywrightTestConfig = {},
  env: NodeJS.ProcessEnv = process.env,
): PlaywrightTestConfig {
  const executablePath = chromiumExecutable(env)

  return {
    testDir: "./e2e/tests",
    outputDir: "./e2e/.artifacts/test-results",
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!env.CI,
    reporter: [
      ["list"],
      ["html", { outputFolder: "./e2e/.artifacts/report", open: "never" }],
    ],
    ...overrides,
    use: {
      trace: "retain-on-failure",
      screenshot: "only-on-failure",
      ...(executablePath
        ? {
            launchOptions: {
              executablePath,
              args: ["--no-proxy-server"],
            },
          }
        : {}),
      ...overrides.use,
    },
  }
}
