/**
 * How an AI is connected to an app over MCP and OAuth, as pure helpers the
 * consent screen and the MCP route share, so both say the same thing. Scope
 * names, their words, the audience and the route's path are the app's own.
 */

export type ScopeInfo = { scope: string; label: string; caption: string }

/** The MCP server's address under an origin, for a path like `/api/mcp`. */
export const mcpUrl = (origin: string, path: string) =>
  `${origin.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`

/**
 * A registered client's own address, as something a consent screen may draw
 * as a link: any app may register itself and say what it likes, and a
 * `javascript:` or `data:` URI would run or render on the one screen that
 * hands an app the person's data. Only an http(s) address comes back.
 */
export const webAddress = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined
  } catch {
    return undefined
  }
}

/** A scope claim, a space-separated string or nothing, as a set. */
export const scopesOf = (claim: unknown): Set<string> =>
  new Set(typeof claim === "string" ? claim.split(" ").filter(Boolean) : [])

/** Scopes as rows to draw: the known ones in their own words, anything else by name alone. */
export const describeScopes = (
  scopes: Iterable<string>,
  known: readonly ScopeInfo[],
): ScopeInfo[] =>
  Array.from(scopes).map(
    (scope) =>
      known.find((one) => one.scope === scope) ?? {
        scope,
        label: scope,
        caption: "",
      },
  )

/** What the authorize endpoint adds as it sends the browser to a login or consent page: the provider's, not the request's. */
const SIGNATURE_PARAMS = ["sig", "exp", "ba_iat", "ba_param", "ba_pl"]

/** Prompts answered by the page they sent the browser to, and so not to be asked twice. */
const SPENT_PROMPTS = new Set(["login", "create"])

/** Whether a page was reached from the authorize endpoint: a signed query naming a client. */
export const isAuthorizeQuery = (search: string) => {
  const params = new URLSearchParams(search)
  return params.has("client_id") && params.has("sig")
}

/**
 * Where to go once signed in, when the login page was reached from an
 * authorize request: the same request, asked again. The provider signs the
 * query it sends the login page and the signature lasts minutes, so asking
 * afresh, with the same client and scopes, is refused for nothing. The prompts
 * that sent the browser to the login page are dropped: asked again they would
 * send it there again. `authorizePath` is the provider's authorize endpoint
 * (`/api/auth/oauth2/authorize` for Better Auth).
 */
export const resumeAuthorizeUrl = (
  search: string,
  authorizePath = "/api/auth/oauth2/authorize",
): string | undefined => {
  const params = new URLSearchParams(search)
  if (!params.has("client_id") || !params.has("sig")) return undefined
  SIGNATURE_PARAMS.forEach((name) => params.delete(name))
  const prompts = (params.get("prompt") ?? "")
    .split(" ")
    .filter((p) => p && !SPENT_PROMPTS.has(p))
  if (prompts.length > 0) params.set("prompt", prompts.join(" "))
  else params.delete("prompt")
  return `${authorizePath}?${params.toString()}`
}

/** What a consent page was asked: which client, for what. */
export type ConsentRequest = { clientId: string; scopes: string[] }

export const consentRequest = (search: string): ConsentRequest | undefined => {
  const params = new URLSearchParams(search)
  const clientId = params.get("client_id")
  if (!clientId) return undefined
  return { clientId, scopes: Array.from(scopesOf(params.get("scope"))) }
}
