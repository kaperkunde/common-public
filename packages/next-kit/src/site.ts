/**
 * Who runs every Kaperkunde site, as each footer and every outbound email
 * states it. Taken from the provider block in kaperkunde/legal; keep the two
 * in step if the registration ever changes.
 */
export const OPERATOR = {
  name: "Kaperkunde",
  url: "https://kaperkunde.com",
  kvk: "42061326",
  country: "the Netherlands",
} as const

/**
 * The public origin a deployment answers on, without a trailing slash: the
 * first of `variables` that is set (an app's own, then BETTER_AUTH_URL),
 * else `fallback`. There is no hard-coded production fallback by default, so
 * a dev build never advertises production URLs in its sitemap or robots.
 */
export function siteUrlFrom(
  variables: readonly string[],
  {
    fallback = "http://localhost:3000",
    env = process.env,
  }: { fallback?: string; env?: Record<string, string | undefined> } = {},
): string {
  for (const name of variables) {
    const value = env[name]?.trim()
    if (value) return value.replace(/\/+$/, "")
  }
  return fallback.replace(/\/+$/, "")
}
