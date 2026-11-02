/**
 * The origin a request arrived at: its Host, or what a proxy in front says
 * in X-Forwarded-*.
 */
export function originFromHeaders(headers: Headers): string {
  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http"
  const host =
    headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    headers.get("host") ||
    "localhost"
  return `${proto}://${host}`
}

/**
 * Whether a request was sent by one of the site's own pages. A route handler
 * that acts for a signed-in user with their cookie has to ask, or any site
 * they visit could have their browser send it. Browsers put Sec-Fetch-Site on
 * every request and Origin on every POST; a request with neither is refused
 * rather than trusted.
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site")
  if (site !== null) return site === "same-origin"
  const origin = request.headers.get("origin")
  return origin !== null && origin === originFromHeaders(request.headers)
}
