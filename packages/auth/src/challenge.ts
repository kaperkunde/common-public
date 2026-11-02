import type { McpUrls } from "./urls"

/** The headers an MCP route answers with, for clients in the browser too. */
export const MCP_CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
}

/** A response with CORS headers set over its own. */
export function withCors(
  response: Response,
  headers: Readonly<Record<string, string>> = MCP_CORS_HEADERS,
): Response {
  const merged = new Headers(response.headers)
  for (const [key, value] of Object.entries(headers)) merged.set(key, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  })
}

function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`
}

/**
 * The WWW-Authenticate value that sends a client to sign in (RFC 6750 and
 * 9728): where the resource's metadata is, and the scopes to ask for. A
 * client reads `scope` to build its authorization request, and adds
 * offline_access itself when it is listed.
 */
export function bearerChallenge({
  urls,
  scopes,
  error,
  description,
}: {
  urls: Pick<McpUrls, "resourceMetadataUrl">
  scopes: readonly string[]
  error?: "invalid_token" | "insufficient_scope" | "invalid_request"
  description?: string
}): string {
  const parts = [
    ...(error ? [`error=${quoted(error)}`] : []),
    ...(description ? [`error_description=${quoted(description)}`] : []),
    `resource_metadata=${quoted(urls.resourceMetadataUrl)}`,
    `scope=${quoted(scopes.join(" "))}`,
  ]
  return `Bearer ${parts.join(", ")}`
}

/**
 * A JSON-RPC error answer with its challenge: 401 to sign in again, 403 for
 * a token without the scope a call needs.
 */
export function mcpAuthError({
  status,
  message,
  challenge,
}: {
  status: 401 | 403
  message: string
  challenge: string
}): Response {
  return withCors(
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message },
        id: null,
      }),
      {
        status,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": challenge,
        },
      },
    ),
  )
}

/** The token of an `Authorization: Bearer …` request, or null. */
export function bearerTokenFrom(request: Request): string | null {
  const match = (request.headers.get("authorization") ?? "").match(
    /^Bearer\s+(.+)$/i,
  )
  return match?.[1]?.trim() || null
}

/** Tool names a JSON-RPC body calls (one request or a batch), for scope checks and rate buckets. */
export async function calledToolNames(request: Request): Promise<string[]> {
  if (request.method !== "POST") return []
  let body: unknown
  try {
    body = await request.clone().json()
  } catch {
    return []
  }
  const messages = Array.isArray(body) ? body : [body]
  return messages.flatMap((message) => {
    const m = message as {
      method?: unknown
      params?: { name?: unknown }
    } | null
    return m?.method === "tools/call" && typeof m.params?.name === "string"
      ? [m.params.name]
      : []
  })
}
