import { createServer, type Server } from "node:http"

/** What the model was sent, read for a script. */
export type FakeRequest = {
  /** The parsed request body, as sent. */
  body: Record<string, unknown>
  model: string
  /** Names of the tools on offer. */
  tools: string[]
  /** The last user message as text. */
  lastUserText: string
  /** The whole prompt, every message as text, joined by newlines. */
  prompt: string
  /** Whether the last message is a tool's answer. */
  answeringATool: boolean
  /** The last tool answer's text, or "". */
  lastToolText: string
  /** Whether the model has already called this tool in this conversation. */
  called: (name: string) => boolean
  /** Whether a tool on offer takes this argument. */
  takes: (tool: string, argument: string) => boolean
  /** How many requests the server has had, this one included. */
  count: number
}

export type FakeToolCall = { name: string; args?: unknown }

/** What it answers: words, or tool calls. */
export type FakeReply = { text?: string; calls?: FakeToolCall[] }

export type FakeLlmOptions = {
  /** 0 picks a free port. */
  port?: number
  host?: string
  /**
   * Decides each answer from the request. Return a reply, or undefined to fall
   * through to `replies`, then to `fallbackText`. Scripts are the test's own:
   * nothing here knows what an app's prompts say.
   */
  script?: (request: FakeRequest) => FakeReply | undefined
  /** Replies handed out in order, one per request that the script left alone. */
  replies?: FakeReply[]
  /** Said when nothing else answers. */
  fallbackText?: string
  /** What every reply reports as used, so a ledger assertion is a fixed number. */
  usage?: { promptTokens: number; completionTokens: number }
  /** Model ids `/v1/models` lists. */
  models?: string[]
  /** Answer the next requests with this HTTP status and message first, then carry on. */
  failFirst?: { count: number; status: number; message?: string }
}

export type FakeLlm = {
  port: number
  /** `http://host:port/v1`, the base URL for an OpenAI-compatible client. */
  baseURL: string
  /** What it was asked, newest last (capped at 500). */
  seen: () => { tools: string[]; prompt: string; model: string }[]
  /** Replaces the script between steps of a test. */
  setScript: (script: FakeLlmOptions["script"]) => void
  /** Queues more in-order replies. */
  queue: (...replies: FakeReply[]) => void
  close: () => Promise<void>
}

const SEEN_LIMIT = 500

const text = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (part as { text?: string }).text ?? "").join(" ")
      : ""

type Message = {
  role?: string
  content?: unknown
  tool_calls?: { function?: { name?: string } }[]
}
type Tool = {
  function?: {
    name?: string
    parameters?: { properties?: Record<string, unknown> }
  }
}

const requestOf = (
  body: Record<string, unknown>,
  count: number,
): FakeRequest => {
  const messages = (body.messages as Message[] | undefined) ?? []
  const tools = (body.tools as Tool[] | undefined) ?? []
  const last = messages[messages.length - 1]
  const lastUser = [...messages].reverse().find((m) => m.role === "user")
  const lastTool = [...messages].reverse().find((m) => m.role === "tool")
  return {
    body,
    model: String(body.model ?? "fake-model"),
    tools: tools
      .map((t) => t.function?.name)
      .filter((n): n is string => Boolean(n)),
    lastUserText: text(lastUser?.content),
    prompt: messages
      .map((m) =>
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      )
      .join("\n"),
    answeringATool: last?.role === "tool",
    lastToolText: text(lastTool?.content),
    called: (name) =>
      messages.some((m) =>
        (m.tool_calls ?? []).some((c) => c.function?.name === name),
      ),
    takes: (tool, argument) =>
      Boolean(
        tools.find((t) => t.function?.name === tool)?.function?.parameters
          ?.properties?.[argument],
      ),
    count,
  }
}

/**
 * A language model that says what the test told it to, over the
 * OpenAI-compatible chat-completions protocol (streaming included), and
 * remembers what it was sent. Real models are slow, cost money and answer
 * differently every run; this answers from a script and reports the same
 * usage every time.
 */
export const createFakeLlm = async (
  options: FakeLlmOptions = {},
): Promise<FakeLlm> => {
  const usage = options.usage ?? { promptTokens: 100, completionTokens: 20 }
  const usageBody = {
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.promptTokens + usage.completionTokens,
  }
  const seen: ReturnType<FakeLlm["seen"]> = []
  const replies = [...(options.replies ?? [])]
  let script = options.script
  let count = 0
  let failures = options.failFirst?.count ?? 0

  const toMessage = (reply: FakeReply) =>
    reply.calls?.length
      ? {
          role: "assistant",
          content: null,
          tool_calls: reply.calls.map((call, i) => ({
            id: `call_${count}_${i}`,
            type: "function",
            function: {
              name: call.name,
              arguments: JSON.stringify(call.args ?? {}),
            },
          })),
        }
      : {
          role: "assistant",
          content: reply.text ?? options.fallbackText ?? "Nothing to say.",
        }

  const server: Server = createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(body))
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
      json(200, {
        object: "list",
        data: (options.models ?? ["fake-small", "fake-large"]).map((id) => ({
          id,
          object: "model",
        })),
      })
      return
    }
    if (req.method !== "POST" || !req.url?.startsWith("/v1/chat/completions")) {
      json(404, { error: { message: "no such thing here" } })
      return
    }
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      let body: Record<string, unknown> = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      } catch {
        body = {}
      }
      count += 1
      const request = requestOf(body, count)
      seen.push({
        tools: request.tools,
        prompt: request.prompt,
        model: request.model,
      })
      if (seen.length > SEEN_LIMIT) seen.splice(0, seen.length - SEEN_LIMIT)
      if (failures > 0 && options.failFirst) {
        failures -= 1
        json(options.failFirst.status, {
          error: { message: options.failFirst.message ?? "scripted failure" },
        })
        return
      }
      const reply = script?.(request) ?? replies.shift() ?? {}
      const message = toMessage(reply)
      const finish = reply.calls?.length ? "tool_calls" : "stop"
      if (body.stream) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        })
        const chunk = (
          delta: unknown,
          finishReason: string | null = null,
          extra = {},
        ) =>
          `data: ${JSON.stringify({
            id: "fake-completion",
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: request.model,
            choices: delta
              ? [{ index: 0, delta, finish_reason: finishReason }]
              : [],
            ...extra,
          })}\n\n`
        if (message.tool_calls) {
          res.write(
            chunk({
              role: "assistant",
              tool_calls: message.tool_calls.map((one, index) => ({
                index,
                ...one,
              })),
            }),
          )
        } else {
          String(message.content ?? "")
            .split(/(?<= )/)
            .forEach((word, index) =>
              res.write(
                chunk({
                  ...(index === 0 ? { role: "assistant" } : {}),
                  content: word,
                }),
              ),
            )
        }
        res.write(chunk({}, finish))
        res.write(chunk(undefined, null, { usage: usageBody }))
        res.end("data: [DONE]\n\n")
        return
      }
      json(200, {
        id: "fake-completion",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: request.model,
        choices: [{ index: 0, message, finish_reason: finish }],
        usage: usageBody,
      })
    })
  })

  const host = options.host ?? "127.0.0.1"
  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, host, resolve),
  )
  const address = server.address()
  const port =
    typeof address === "object" && address ? address.port : (options.port ?? 0)
  return {
    port,
    baseURL: `http://${host}:${port}/v1`,
    seen: () => [...seen],
    setScript: (next) => {
      script = next
    },
    queue: (...more) => {
      replies.push(...more)
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections?.()
      }),
  }
}
