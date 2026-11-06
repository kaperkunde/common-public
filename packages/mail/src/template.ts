/**
 * One template for every message a Kaperkunde app sends. Callers hand over
 * text, never markup: it is escaped here and the HTML and plain-text parts
 * are rendered from the same content, so the two cannot drift and every mail
 * carries the brand, the reason it was sent and the footer. The markup is
 * deliberately plain (tables, inline styles, no web fonts or media queries),
 * because that is what mail clients and their spam filters accept.
 *
 * The plain-text part puts the call to action first among the links, as
 * "<label>: <url>": that is what a plain-text reader acts on, and what the
 * Mailpit helpers' firstLink reads.
 */

/** A run of text, or one set in bold (a code, a name). */
export type EmailInline = string | { strong: string }

/** One paragraph: plain text, or text with bold runs in it. */
export type EmailParagraph = string | readonly EmailInline[]

export type EmailLink = { label: string; url: string }

export type EmailContent = {
  heading: string
  paragraphs: readonly EmailParagraph[]
  /** The one call to action. */
  cta?: { text: string; url: string }
  /** A quieter second link under the button. */
  secondaryLink?: { text: string; url: string }
  /** Small print under the action (what to do if the mail was not expected). */
  footnote?: string
  /** Links that belong to this message (the ways to stop this kind of mail), before the theme's. */
  links?: readonly EmailLink[]
  /** Why this address got the mail, as one sentence. Required: no message goes out without it. */
  reason: string
  /** The inbox preview line. Defaults to the first paragraph. */
  preheader?: string
}

export type EmailTheme = {
  /** The brand's name, beside the logo and at the end of the text part. */
  name: string
  /** Absolute: mail clients have no page to resolve a relative path against. */
  siteUrl: string
  /** An absolute URL, with explicit size, since clients reserve space from the attributes. */
  logo?: { url: string; width: number; height: number }
  colors: {
    page: string
    card: string
    border: string
    heading: string
    text: string
    muted: string
    primary: string
    onPrimary: string
  }
  fonts?: { body?: string; heading?: string }
  /** Border radius of the card and button, in px. */
  radius?: number
  /** The card's maximum width, in px (520 when unset). */
  maxWidth?: number
  /** Letter spacing of the name beside the logo, as CSS ("-0.01em"); none when unset. */
  nameLetterSpacing?: string
  /** The `color-scheme` meta: "dark", "light" or "dark light". */
  colorScheme?: string
  /** Links every message of this brand ends with (Terms, Privacy, Support). */
  footerLinks?: readonly EmailLink[]
  /** The operator line: "Made with care in the Netherlands by Kaperkunde · KVK …". */
  operator?: {
    name: string
    url: string
    country: string
    kvk?: string
    verb?: string
  }
}

export type RenderedEmail = { html: string; text: string }

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function inlines(paragraph: EmailParagraph): readonly EmailInline[] {
  return typeof paragraph === "string" ? [paragraph] : paragraph
}

function paragraphText(paragraph: EmailParagraph): string {
  return inlines(paragraph)
    .map((part) => (typeof part === "string" ? part : part.strong))
    .join("")
}

function operatorLine(
  theme: EmailTheme,
): { prefix: string; suffix: string } | null {
  const op = theme.operator
  if (!op) return null
  return {
    prefix: `${op.verb ?? "Made with care"} in ${op.country} by`,
    suffix: op.kvk ? `KVK ${op.kvk}` : "",
  }
}

function renderHtml(content: EmailContent, theme: EmailTheme): string {
  const c = theme.colors
  const body =
    theme.fonts?.body ??
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
  const headingFont = theme.fonts?.heading ?? body
  const radius = theme.radius ?? 12
  const maxWidth = theme.maxWidth ?? 520
  const nameSpacing = theme.nameLetterSpacing
    ? `letter-spacing:${escapeHtml(theme.nameLetterSpacing)};`
    : ""
  const site = escapeHtml(theme.siteUrl)
  const preheader = escapeHtml(
    content.preheader ??
      (content.paragraphs[0] ? paragraphText(content.paragraphs[0]) : ""),
  )

  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${c.text};">${inlines(
          p,
        )
          .map((part) =>
            typeof part === "string"
              ? escapeHtml(part)
              : `<strong style="color:${c.heading};">${escapeHtml(part.strong)}</strong>`,
          )
          .join("")}</p>`,
    )
    .join("")

  const cta = content.cta
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(content.cta.url)}" style="display:inline-block;background:${c.primary};color:${c.onPrimary};text-decoration:none;font-weight:600;padding:12px 24px;border-radius:${Math.min(radius, 8)}px;font-size:15px;">${escapeHtml(content.cta.text)}</a></p>`
    : ""
  const secondary = content.secondaryLink
    ? `<p style="margin:16px 0 0;font-size:14px;"><a href="${escapeHtml(content.secondaryLink.url)}" style="color:${c.text};text-decoration:underline;">${escapeHtml(content.secondaryLink.text)}</a></p>`
    : ""
  const footnote = content.footnote
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:${c.muted};">${escapeHtml(content.footnote)}</p>`
    : ""

  const small = `margin:0 0 8px;font-size:12px;line-height:1.5;color:${c.muted};`
  const linkStyle = `color:${c.muted};text-decoration:underline;`
  const links = [...(content.links ?? []), ...(theme.footerLinks ?? [])]
    .map(
      (l) =>
        `<a href="${escapeHtml(l.url)}" style="${linkStyle}">${escapeHtml(l.label)}</a>`,
    )
    .join(" &middot; ")
  const op = operatorLine(theme)
  const operator =
    op && theme.operator
      ? `<p style="${small}">${escapeHtml(op.prefix)} <a href="${escapeHtml(theme.operator.url)}" style="${linkStyle}">${escapeHtml(theme.operator.name)}</a>${op.suffix ? ` &middot; ${escapeHtml(op.suffix)}` : ""}</p>`
      : ""

  const logo = theme.logo
    ? `<td style="vertical-align:middle;padding-right:10px;"><a href="${site}" style="text-decoration:none;"><img src="${escapeHtml(theme.logo.url)}" alt="" width="${theme.logo.width}" height="${theme.logo.height}" style="display:block;width:${theme.logo.width}px;height:${theme.logo.height}px;border:0;outline:none;" /></a></td>`
    : ""

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="${escapeHtml(theme.colorScheme ?? "dark light")}" />
    <title>${escapeHtml(content.heading)}</title>
  </head>
  <body style="margin:0;padding:32px 16px;background:${c.page};color:${c.text};font-family:${body};">
    <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.page};">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${maxWidth}px;background:${c.card};border:1px solid ${c.border};border-radius:${radius}px;">
            <tr>
              <td style="padding:32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>${logo}<td style="vertical-align:middle;"><a href="${site}" style="color:${c.heading};text-decoration:none;font-size:18px;font-weight:600;${nameSpacing}">${escapeHtml(theme.name)}</a></td></tr></table>
                <h1 style="margin:0 0 16px;font-family:${headingFont};font-size:20px;font-weight:600;color:${c.heading};">${escapeHtml(content.heading)}</h1>
                ${paragraphs}${cta}${secondary}${footnote}
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${maxWidth}px;">
            <tr>
              <td style="padding:20px 32px 0;text-align:center;">
                <p style="${small}">${escapeHtml(content.reason)}</p>
                ${links ? `<p style="${small}">${links}</p>` : ""}
                ${operator}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function renderText(content: EmailContent, theme: EmailTheme): string {
  const lines = [
    content.heading,
    "",
    ...content.paragraphs.flatMap((p) => [paragraphText(p), ""]),
  ]
  if (content.cta) lines.push(`${content.cta.text}: ${content.cta.url}`, "")
  if (content.secondaryLink)
    lines.push(
      `${content.secondaryLink.text}: ${content.secondaryLink.url}`,
      "",
    )
  if (content.footnote) lines.push(content.footnote, "")
  lines.push("--", content.reason, "")
  for (const l of [...(content.links ?? []), ...(theme.footerLinks ?? [])]) {
    lines.push(`${l.label}: ${l.url.replace(/^mailto:/, "")}`)
  }
  const op = operatorLine(theme)
  if (op && theme.operator) {
    lines.push(
      "",
      `${op.prefix} ${theme.operator.name} (${theme.operator.url})${op.suffix ? ` · ${op.suffix}` : ""}`,
    )
  } else {
    lines.push("", `— ${theme.name}`)
  }
  return lines.join("\n")
}

/** Renders one message in a brand's theme: both parts, from the same content. */
export function renderEmail(
  content: EmailContent,
  theme: EmailTheme,
): RenderedEmail {
  return { html: renderHtml(content, theme), text: renderText(content, theme) }
}
