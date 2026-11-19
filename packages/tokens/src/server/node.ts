import type { IncomingMessage, ServerResponse } from "node:http"

export type NodeHandlerOptions = {
  /** Trust `x-forwarded-proto` / `x-forwarded-host` for the request's URL (behind your own proxy). Default true. */
  trustForwarded?: boolean
}

async function readBody(
  req: IncomingMessage,
): Promise<Uint8Array | string | undefined> {
  // Next's pages router may have parsed the body already.
  const parsed = (req as IncomingMessage & { body?: unknown }).body
  if (parsed !== undefined && parsed !== null) {
    if (typeof parsed === "string") return parsed
    if (parsed instanceof Uint8Array) return parsed
    if (
      typeof parsed === "object" &&
      Object.keys(parsed).length === 0 &&
      req.readableEnded
    )
      return undefined
    return JSON.stringify(parsed)
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return chunks.length ? Buffer.concat(chunks) : undefined
}

/** A Node `IncomingMessage` as a Web `Request`. */
export async function requestFromNode(
  req: IncomingMessage,
  options: NodeHandlerOptions = {},
): Promise<Request> {
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim()
  const trust = options.trustForwarded !== false
  const proto =
    (trust && first(req.headers["x-forwarded-proto"])) ||
    ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http")
  const host =
    (trust && first(req.headers["x-forwarded-host"])) ||
    req.headers.host ||
    "localhost"
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const v of value) headers.append(key, v)
    else headers.set(key, value)
  }
  const method = req.method ?? "GET"
  const body =
    method === "GET" || method === "HEAD" ? undefined : await readBody(req)
  return new Request(`${proto}://${host}${req.url ?? "/"}`, {
    method,
    headers,
    body: body as BodyInit | undefined,
  })
}

/** Write a Web `Response` to a Node `ServerResponse`. */
export async function sendResponse(
  response: Response,
  res: ServerResponse,
): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value)
  })
  const cookies = response.headers.getSetCookie?.() ?? []
  if (cookies.length) res.setHeader("set-cookie", cookies)
  if (!response.body) return void res.end()
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    res.write(value)
  }
  res.end()
}

/**
 * Bridge a Web handler (`tokenRoutes(…)`, `webhookRoute(…)`) into a Next
 * **pages router** API route:
 *
 * ```ts
 * // pages/api/tokens/[...op].ts
 * export const config = { api: { bodyParser: false } }
 * export default nodeHandler(tokenRoutes(center, { userOf }))
 * ```
 *
 * Turn the body parser off for a webhook (the signature is over the raw
 * bytes); for `tokenRoutes` it may stay on, a parsed body is re-serialised.
 */
export function nodeHandler(
  handler: (request: Request) => Promise<Response> | Response,
  options: NodeHandlerOptions = {},
) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      await sendResponse(
        await handler(await requestFromNode(req, options)),
        res,
      )
    } catch (error) {
      console.error("[tokens] handler failed", error)
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader("content-type", "application/json")
      }
      res.end(
        JSON.stringify({
          error: { code: "internal_error", message: "Something went wrong." },
        }),
      )
    }
  }
}
