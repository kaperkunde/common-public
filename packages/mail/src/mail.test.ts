import { describe, expect, it } from "vitest"

import { renderEmail, smtpSettings, type EmailTheme } from "./index"
import { firstLink } from "./testing"

const theme: EmailTheme = {
  name: "pcp.gg",
  siteUrl: "https://pcp.gg",
  logo: { url: "https://pcp.gg/mark.png", width: 32, height: 32 },
  colors: {
    page: "#131720",
    card: "#1c2230",
    border: "#2a3242",
    heading: "#e6e9ef",
    text: "#e6e9ef",
    muted: "#97a1b3",
    primary: "#5ed3c3",
    onPrimary: "#0d1117",
  },
  footerLinks: [
    { label: "Terms", url: "https://pcp.gg/terms" },
    { label: "Support", url: "mailto:hello@pcp.gg" },
  ],
  operator: {
    name: "Kaperkunde",
    url: "https://kaperkunde.com",
    country: "the Netherlands",
    kvk: "42061326",
  },
}

describe("renderEmail", () => {
  const rendered = renderEmail(
    {
      heading: "Reset your password",
      paragraphs: [
        "Someone asked <to reset>.",
        ["Your code is ", { strong: "K7QF" }, "."],
      ],
      cta: {
        text: "Choose a new password",
        url: "https://pcp.gg/reset?t=1&x=2",
      },
      footnote: "Didn't ask? Ignore this.",
      links: [{ label: "Unsubscribe", url: "https://pcp.gg/u/abc" }],
      reason:
        "You're receiving this because someone asked to reset your password.",
    },
    theme,
  )

  it("escapes text and renders both parts from the same content", () => {
    expect(rendered.html).toContain("Someone asked &lt;to reset&gt;.")
    expect(rendered.html).toContain(
      '<strong style="color:#e6e9ef;">K7QF</strong>',
    )
    expect(rendered.html).toContain('href="https://pcp.gg/reset?t=1&amp;x=2"')
    expect(rendered.html).toContain(
      'src="https://pcp.gg/mark.png" alt="" width="32" height="32"',
    )
    expect(rendered.text).toContain("Your code is K7QF.")
    expect(rendered.text).toContain("Support: hello@pcp.gg")
  })

  it("puts the call to action first among the text part's links", () => {
    expect(firstLink(rendered.text)).toBe("https://pcp.gg/reset?t=1&x=2")
  })

  it("ends with the reason, the message's links, the theme's and the operator", () => {
    const tail = rendered.text.slice(rendered.text.indexOf("--"))
    expect(tail).toBe(
      [
        "--",
        "You're receiving this because someone asked to reset your password.",
        "",
        "Unsubscribe: https://pcp.gg/u/abc",
        "Terms: https://pcp.gg/terms",
        "Support: hello@pcp.gg",
        "",
        "Made with care in the Netherlands by Kaperkunde (https://kaperkunde.com) · KVK 42061326",
      ].join("\n"),
    )
  })

  it("uses the first paragraph as the preheader", () => {
    expect(rendered.html).toContain(
      'line-height:1px;">Someone asked &lt;to reset&gt;.</div>',
    )
  })
})

describe("smtpSettings", () => {
  it("reads the app's prefix, with Mailpit as the default", () => {
    expect(
      smtpSettings("APP_SMTP", { defaultFrom: "App <no@app>", env: {} }),
    ).toEqual({
      host: "localhost",
      port: 1025,
      secure: false,
      from: "App <no@app>",
    })
    expect(
      smtpSettings("SMTP", {
        defaultFrom: "x",
        env: {
          SMTP_HOST: "mail",
          SMTP_PORT: "465",
          SMTP_USER: "u",
          SMTP_PASS: "p",
          SMTP_REPLY_TO: "r@x",
        },
      }),
    ).toEqual({
      host: "mail",
      port: 465,
      secure: true,
      auth: { user: "u", pass: "p" },
      from: "x",
      replyTo: "r@x",
    })
  })
})
