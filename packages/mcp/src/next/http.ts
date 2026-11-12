import type { IncomingMessage, ServerResponse } from "node:http"

/**
 * The SDK's HTTP entries speak web-standard `Request` and `Response`. An
 * app-router route is handed those and needs no bridge. A pages-router API
 * route is handed Node's `IncomingMessage` and `ServerResponse`, with the body
 * already parsed by Next: these three are the whole of that bridge, with no
 * framework adapter, so nothing is installed for it.
 */

/** Header values as one string each, the way `Headers` holds them. */
export const headerPairs = (
  headers: IncomingMessage["headers"],
): [string, string][] =>
  Object.entries(headers).flatMap(([key, value]) => {
    if (value === undefined) return []
    return [[key, Array.isArray(value) ? value.join(", ") : value]]
  })

/**
 * The request as the SDK reads it. Next has already drained the body into
 * `body`, so it is written back as JSON; hand the SDK the parsed value too
 * (`parsedBody`) and it reads that.
 */
export const toWebRequest = (req: IncomingMessage, body: unknown): Request => {
  const host = req.headers.host ?? "localhost"
  const method = req.method ?? "GET"
  return new Request(new URL(req.url ?? "/", `http://${host}`), {
    method,
    headers: headerPairs(req.headers),
    ...(method === "GET" || method === "HEAD" || body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  })
}

/**
 * Writes the SDK's answer to Node's response: the status, the headers, and
 * the body chunk by chunk as it arrives, each flushed past Next's compression
 * (`flush`, when there is one) so an event stream's progress reaches the
 * client while the tool works rather than at the end. A reader who goes away
 * cancels the rest.
 */
export const sendWebResponse = async (
  res: ServerResponse,
  response: Response,
): Promise<void> => {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  if (!response.body) {
    res.end()
    return
  }
  const { flush } = res as unknown as { flush?: () => void }
  const reader = response.body.getReader()
  const gone = () => {
    reader.cancel().catch(() => undefined)
  }
  res.on("close", gone)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
      if (typeof flush === "function") flush.call(res)
    }
  } catch {
    // The reader went away, or the server ended the stream: nothing more to send.
  } finally {
    res.off("close", gone)
    res.end()
  }
}

/** A response made by an app-router route with `Cache-Control: no-store`, as every MCP answer should carry. */
export const noStore = (response: Response): Response => {
  const headers = new Headers(response.headers)
  headers.set("Cache-Control", "no-store")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
