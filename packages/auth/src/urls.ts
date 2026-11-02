/**
 * The addresses an MCP connector's OAuth needs. The issuer is the site
 * origin itself, not Better Auth's /api/auth base path, so the authorization
 * server's metadata sits at the plain /.well-known path every MCP client
 * probes first; the endpoints it lists still point into /api/auth/oauth2/*.
 */
export type McpUrls = {
  /** The site origin. */
  issuer: string
  /** The protected resource tokens are bound to: the connector URL a person pastes, byte for byte. */
  resource: string
  /** Where the route verifies access tokens. Over loopback: the keys belong to this process. */
  jwksUrl: string
  /** RFC 9728's metadata document for the resource. */
  resourceMetadataUrl: string
}

export function mcpUrls({
  siteUrl,
  resourcePath = "/mcp",
  port = process.env.PORT?.trim() || "3000",
  jwksUrl = process.env.MCP_JWKS_URL?.trim(),
}: {
  siteUrl: string
  resourcePath?: string
  port?: string
  jwksUrl?: string
}): McpUrls {
  const issuer = siteUrl.replace(/\/+$/, "")
  const resource = `${issuer}${resourcePath}`
  return {
    issuer,
    resource,
    jwksUrl: jwksUrl || `http://127.0.0.1:${port}/api/auth/jwks`,
    resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource${resourcePath}`,
  }
}
