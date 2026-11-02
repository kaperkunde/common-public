import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import {
  fail,
  field,
  formatDate,
  guarded,
  llmsTxt,
  normalizeCode,
  ok,
  plural,
  randomCode,
  robotsFor,
  shortName,
  siteUrlFrom,
  sitemapFor,
  slugify,
  statusFor,
  textValues,
  timeAgo,
  uniqueSlug,
  type Result,
} from "./index"
import { LocalDate } from "./local-date"

describe("Result and guarded", () => {
  it("turns a success into ok state with its payload", async () => {
    const state = await guarded(async (): Promise<Result<{ id: string }>> =>
      ok({ id: "x" }),
    )
    expect(state).toEqual({ status: "ok", id: "x" })
  })

  it("turns a failure into the message, code and field", async () => {
    const state = await guarded(
      async (): Promise<Result<{ id: string }>> =>
        fail("INVALID", "Pick a name.", { field: "name" }),
      { values: { name: "" } },
    )
    expect(state).toEqual({
      status: "error",
      error: "Pick a name.",
      code: "INVALID",
      field: "name",
      values: { name: "" },
    })
  })

  it("logs a throw and shows only the unexpected message", async () => {
    const log = vi.fn()
    const state = await guarded(
      async () => {
        throw new Error("db down")
      },
      { log, unexpected: "Oops." },
    )
    expect(state).toEqual({ status: "error", error: "Oops." })
    expect(log).toHaveBeenCalledOnce()
  })

  it("maps codes to statuses", () => {
    expect(statusFor("NOT_FOUND")).toBe(404)
    expect(statusFor("SOMETHING_ELSE")).toBe(400)
  })
})

describe("form data", () => {
  it("reads text fields and keeps passwords out of refill values", () => {
    const form = new FormData()
    form.set("name", "Ash")
    form.set("password", "secret")
    form.set("$ACTION_ID", "x")
    expect(field(form, "name")).toBe("Ash")
    expect(field(form, "missing")).toBe("")
    expect(textValues(form)).toEqual({ name: "Ash" })
  })
})

describe("site and seo", () => {
  it("picks the first set variable, without a trailing slash", () => {
    expect(siteUrlFrom(["A", "B"], { env: { B: "https://x.example/" } })).toBe(
      "https://x.example",
    )
    expect(siteUrlFrom(["A"], { env: {} })).toBe("http://localhost:3000")
  })

  it("builds robots, sitemap and llms.txt", () => {
    expect(robotsFor({ siteUrl: "https://x", disallow: ["/api/"] })).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
      sitemap: "https://x/sitemap.xml",
    })
    expect(robotsFor({ siteUrl: "https://x", closed: true }).rules).toEqual({
      userAgent: "*",
      disallow: "/",
    })
    expect(
      sitemapFor("https://x", ["/", { path: "/terms", priority: 0.3 }]),
    ).toEqual([{ url: "https://x" }, { url: "https://x/terms", priority: 0.3 }])
    expect(
      llmsTxt({
        title: "X",
        summary: "Y",
        sections: [
          {
            title: "Docs",
            links: [{ title: "A", url: "https://a", note: "n" }],
          },
        ],
      }),
    ).toBe("# X\n\n> Y\n\n## Docs\n\n- [A](https://a): n\n")
  })
})

describe("text and codes", () => {
  it("slugs, steps and counts", () => {
    expect(slugify("  Crème Brûlée & Co! ")).toBe("creme-brulee-co")
    expect(slugify("Ash Grey", { separator: "_" })).toBe("ash_grey")
    expect(uniqueSlug("ash", ["ash", "ash_2"])).toBe("ash_3")
    expect(plural(1, "card")).toBe("1 card")
    expect(plural(1204, "card")).toBe("1,204 cards")
    expect(shortName("Kevin van der Lee")).toBe("Kevin L.")
  })

  it("makes readable codes", () => {
    const code = randomCode()
    expect(code).toMatch(
      /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/,
    )
    expect(normalizeCode(" k7qf-m2xr ")).toBe("K7QFM2XR")
  })
})

describe("dates", () => {
  it("formats in the house style", () => {
    const d = new Date("2026-09-23T14:05:00Z")
    expect(formatDate(d, { timeZone: "UTC" })).toBe("23 September 2026")
    expect(formatDate(d, { style: "short", time: true, timeZone: "UTC" })).toBe(
      "23 Sept 2026, 14:05",
    )
    expect(formatDate("not a date")).toBeNull()
    expect(timeAgo(new Date(d.getTime() - 5 * 60_000), d)).toBe("5 minutes ago")
  })

  it("renders LocalDate in UTC on the server", () => {
    const html = renderToStaticMarkup(
      <LocalDate value="2026-09-23T23:30:00Z" />,
    )
    expect(html).toBe(
      '<time dateTime="2026-09-23T23:30:00.000Z">23 September 2026</time>',
    )
  })
})
