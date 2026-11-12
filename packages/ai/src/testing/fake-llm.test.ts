import { afterEach, describe, expect, it } from "vitest"

import { createFakeLlm, type FakeLlm } from "./fake-llm"

let llm: FakeLlm | undefined
afterEach(async () => {
  await llm?.close()
  llm = undefined
})

const chat = (body: object, baseURL: string) =>
  fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

describe("createFakeLlm", () => {
  it("answers from the script with fixed usage and remembers what it was sent", async () => {
    llm = await createFakeLlm({
      script: (request) =>
        request.lastUserText.includes("weather")
          ? { text: "Sunny." }
          : undefined,
      fallbackText: "Nothing.",
      usage: { promptTokens: 7, completionTokens: 3 },
    })
    const answer = await (
      await chat(
        { model: "m", messages: [{ role: "user", content: "the weather?" }] },
        llm.baseURL,
      )
    ).json()
    expect(answer.choices[0].message.content).toBe("Sunny.")
    expect(answer.choices[0].finish_reason).toBe("stop")
    expect(answer.usage).toEqual({
      prompt_tokens: 7,
      completion_tokens: 3,
      total_tokens: 10,
    })
    const other = await (
      await chat({ messages: [{ role: "user", content: "hi" }] }, llm.baseURL)
    ).json()
    expect(other.choices[0].message.content).toBe("Nothing.")
    expect(llm.seen()).toHaveLength(2)
    expect(llm.seen()[0]).toMatchObject({ model: "m", prompt: "the weather?" })
  })

  it("answers with tool calls, and reads the conversation", async () => {
    llm = await createFakeLlm({
      script: (r) =>
        r.answeringATool
          ? { text: `got ${r.lastToolText}` }
          : r.tools.includes("lookup") && r.takes("lookup", "q")
            ? { calls: [{ name: "lookup", args: { q: "x" } }] }
            : undefined,
    })
    const tools = [
      {
        type: "function",
        function: { name: "lookup", parameters: { properties: { q: {} } } },
      },
    ]
    const first = await (
      await chat(
        { messages: [{ role: "user", content: "go" }], tools },
        llm.baseURL,
      )
    ).json()
    const call = first.choices[0].message.tool_calls[0]
    expect(first.choices[0].finish_reason).toBe("tool_calls")
    expect(call.function).toEqual({ name: "lookup", arguments: '{"q":"x"}' })
    const second = await (
      await chat(
        {
          messages: [
            { role: "user", content: "go" },
            { role: "assistant", tool_calls: [call] },
            { role: "tool", tool_call_id: call.id, content: "42" },
          ],
          tools,
        },
        llm.baseURL,
      )
    ).json()
    expect(second.choices[0].message.content).toBe("got 42")
  })

  it("hands out queued replies in order and lets a test swap the script", async () => {
    llm = await createFakeLlm({ replies: [{ text: "one" }] })
    llm.queue({ text: "two" })
    const text = async () =>
      (await (await chat({ messages: [] }, llm!.baseURL)).json()).choices[0]
        .message.content
    expect(await text()).toBe("one")
    expect(await text()).toBe("two")
    expect(await text()).toBe("Nothing to say.")
    llm.setScript(() => ({ text: "scripted" }))
    expect(await text()).toBe("scripted")
  })

  it("fails the first requests as scripted", async () => {
    llm = await createFakeLlm({
      failFirst: { count: 1, status: 503, message: "busy" },
    })
    const first = await chat({ messages: [] }, llm.baseURL)
    expect(first.status).toBe(503)
    expect((await first.json()).error.message).toBe("busy")
    expect((await chat({ messages: [] }, llm.baseURL)).status).toBe(200)
  })

  it("streams words and then the usage", async () => {
    llm = await createFakeLlm({ replies: [{ text: "two words" }] })
    const raw = await (
      await chat({ stream: true, messages: [] }, llm.baseURL)
    ).text()
    const lines = raw
      .split("\n")
      .filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"))
    const chunks = lines.map((l) => JSON.parse(l.slice(6)))
    expect(chunks.map((c) => c.choices[0]?.delta?.content ?? "").join("")).toBe(
      "two words",
    )
    expect(chunks.at(-1).usage.total_tokens).toBe(120)
    expect(raw.trim().endsWith("[DONE]")).toBe(true)
  })

  it("streams tool calls whole", async () => {
    llm = await createFakeLlm({ replies: [{ calls: [{ name: "t" }] }] })
    const raw = await (
      await chat({ stream: true, messages: [] }, llm.baseURL)
    ).text()
    expect(raw).toContain('"tool_calls"')
    expect(raw).toContain('"finish_reason":"tool_calls"')
  })

  it("lists models and 404s elsewhere", async () => {
    llm = await createFakeLlm({ models: ["a", "b"] })
    const models = await (await fetch(`${llm.baseURL}/models`)).json()
    expect(models.data.map((m: { id: string }) => m.id)).toEqual(["a", "b"])
    expect((await fetch(`${llm.baseURL}/nope`)).status).toBe(404)
    expect((await fetch(`${llm.baseURL}/chat/completions`)).status).toBe(404)
  })

  it("tolerates a body that is not JSON", async () => {
    llm = await createFakeLlm()
    const res = await fetch(`${llm.baseURL}/chat/completions`, {
      method: "POST",
      body: "{{",
    })
    expect(res.status).toBe(200)
  })
})
