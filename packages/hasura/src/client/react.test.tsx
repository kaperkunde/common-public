import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { WithHasura, useHasuraConnection } from "./react"

const Probe = () => {
  const { lost, connection } = useHasuraConnection()
  return (
    <p>
      {lost ? "lost" : "ok"}:{typeof connection.client.query}
    </p>
  )
}

const props = {
  endpoint: "http://h/v1/graphql",
  role: "user",
  renderLost: () => <p>gone</p>,
}

describe("WithHasura", () => {
  it("draws the fallback until there is a token", () => {
    expect(
      renderToStaticMarkup(
        <WithHasura {...props} token={null} fallback={<i>signed out</i>}>
          <Probe />
        </WithHasura>,
      ),
    ).toBe("<i>signed out</i>")
  })

  it("provides the connection to its children once there is one", () => {
    const html = renderToStaticMarkup(
      <WithHasura {...props} token="a.b.c" cacheKey="react-test">
        <Probe />
      </WithHasura>,
    )
    expect(html).toContain("ok:function")
  })

  it("refuses useHasuraConnection outside a provider", () => {
    expect(() => renderToStaticMarkup(<Probe />)).toThrow(/WithHasura/)
  })
})
