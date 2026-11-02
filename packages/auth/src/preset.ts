import { cimd } from "@better-auth/cimd"
import { fetchClientMetadataResource } from "@better-auth/cimd/node"
import { mcp } from "@better-auth/mcp"
import { jwt } from "better-auth/plugins"

import type { McpUrls } from "./urls"

/**
 * The Better Auth options an app needs to be an OAuth 2.1 authorization
 * server for its MCP connector, as one object spread into `betterAuth({…})`:
 *
 * - `jwt` signs the access tokens, with its own `/token` endpoint closed and
 *   no set-auth-jwt header on session responses, so a signed-in browser is
 *   never handed a token of the same shape;
 * - `mcp`: authorization code and refresh token only (every token belongs to
 *   a person who approved it), open dynamic registration, an hour's access
 *   token and a refresh token for `refreshDays`;
 * - `cimd` for clients that identify with a metadata document (Claude);
 * - the rate limit, in production only, with room for the OAuth endpoints
 *   every connector reaches from one provider's egress range.
 *
 *   betterAuth({ ...mcpAuthPreset({ urls, scopes, consentPage }), emailAndPassword: … })
 *
 * An app with its own `plugins` passes them in `extraPlugins`.
 */
export function mcpAuthPreset({
  urls,
  scopes,
  loginPage = "/login",
  consentPage = "/oauth/consent",
  refreshDays = 60,
  rateLimited = process.env.NODE_ENV === "production" &&
    process.env.E2E?.trim() !== "1",
  extraPlugins = [],
  disabledPaths = [],
}: {
  urls: Pick<McpUrls, "issuer" | "resource">
  scopes: readonly string[]
  loginPage?: string
  consentPage?: string
  refreshDays?: number
  rateLimited?: boolean
  extraPlugins?: readonly unknown[]
  disabledPaths?: readonly string[]
}) {
  return {
    disabledPaths: ["/token", ...disabledPaths],
    rateLimit: {
      enabled: rateLimited,
      window: 60,
      max: 20,
      customRules: {
        "/oauth2/token": { window: 60, max: 300 },
        "/oauth2/register": { window: 60, max: 60 },
        "/jwks": false as const,
      },
    },
    plugins: [
      jwt({ jwt: { issuer: urls.issuer }, disableSettingJwtHeader: true }),
      mcp({
        loginPage,
        consentPage,
        resource: urls.resource,
        scopes: [...scopes],
        grantTypes: ["authorization_code", "refresh_token"],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        accessTokenExpiresIn: 60 * 60,
        refreshTokenExpiresIn: 60 * 60 * 24 * refreshDays,
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
      ...extraPlugins,
    ],
  }
}

const DISCOVERY_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
}

/**
 * Route handlers for the OAuth discovery documents at the site root. Better
 * Auth serves them from its plugins, but only for requests reaching its
 * handler under /api/auth; MCP clients look for them at the root, so these
 * hand the request on untouched and add CORS for browser clients.
 *
 *   export const { GET, OPTIONS } = discoveryRoute(auth.handler)
 */
export function discoveryRoute(
  handler: (request: Request) => Promise<Response>,
) {
  return {
    async GET(request: Request): Promise<Response> {
      const response = await handler(request)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(DISCOVERY_CORS))
        headers.set(key, value)
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    },
    OPTIONS(): Response {
      return new Response(null, { status: 204, headers: DISCOVERY_CORS })
    },
  }
}
