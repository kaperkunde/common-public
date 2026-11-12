import type { ModelMessage } from "ai"
import { describe, expect, it } from "vitest"

import { CACHE_MARK, markCachePrefix, wholeInstructions } from "./cache"

const messages: ModelMessage[] = [
  { role: "user", content: "world" },
  { role: "user", content: "turn" },
]

describe("wholeInstructions", () => {
  it("puts shared instructions first", () => {
    expect(wholeInstructions("own", "shared")).toBe("shared\n\nown")
    expect(wholeInstructions("own")).toBe("own")
  })
})

describe("markCachePrefix", () => {
  it("leaves the prompt unmarked off Anthropic", () => {
    const out = markCachePrefix("openai-compatible", "own", messages, {
      shared: "s",
      conversation: true,
    })
    expect(out.instructions).toBe("s\n\nown")
    expect(out.messages).toBe(messages)
    expect(out.providerOptions).toBeUndefined()
    expect(markCachePrefix(undefined, "own", messages).instructions).toBe("own")
  })

  it("marks the instructions and the first message on Anthropic", () => {
    const out = markCachePrefix("anthropic", "own", messages)
    expect(out.instructions).toEqual({
      role: "system",
      content: "own",
      providerOptions: CACHE_MARK,
    })
    expect(out.messages[0]?.providerOptions).toEqual(CACHE_MARK)
    expect(out.messages[1]).toBe(messages[1])
    expect(out.providerOptions).toBeUndefined()
  })

  it("gives shared instructions a block and a mark of their own", () => {
    const out = markCachePrefix("anthropic", "own", messages, { shared: "s" })
    expect(out.instructions).toEqual([
      { role: "system", content: "s", providerOptions: CACHE_MARK },
      { role: "system", content: "own", providerOptions: CACHE_MARK },
    ])
  })

  it("adds the automatic mark to a conversation, keeping the call's own options", () => {
    const out = markCachePrefix("anthropic", "own", messages, {
      conversation: true,
      providerOptions: { anthropic: { disableParallelToolUse: true } },
    })
    expect(out.providerOptions).toEqual({
      anthropic: { disableParallelToolUse: true, ...CACHE_MARK.anthropic },
    })
  })

  it("copes with no messages", () => {
    expect(markCachePrefix("anthropic", "own", []).messages).toEqual([])
  })
})
