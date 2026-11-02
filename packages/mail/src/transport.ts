import nodemailer, { type Transporter } from "nodemailer"

import { renderEmail, type EmailContent, type EmailTheme } from "./template"

/**
 * SMTP for one app, its settings read at run time under the app's own
 * prefix: `<PREFIX>_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_FROM`,
 * `_REPLY_TO`. Unset, mail goes to localhost:1025, the Mailpit a dev stack
 * runs. Port 465 is implicit TLS; anything else upgrades with STARTTLS when
 * offered. Timeouts keep a stuck SMTP server from holding a sign-in.
 */
export type SmtpSettings = {
  host: string
  port: number
  secure: boolean
  auth?: { user: string; pass: string }
  from: string
  replyTo?: string
}

export type SendEmailOptions = EmailContent & {
  to: string
  subject: string
  /** Extra headers (List-Unsubscribe on reminders). */
  headers?: Record<string, string>
  replyTo?: string
}

export function smtpSettings(
  prefix: string,
  {
    defaultFrom,
    env = process.env,
  }: { defaultFrom: string; env?: Record<string, string | undefined> },
): SmtpSettings {
  const read = (name: string) => env[`${prefix}_${name}`]?.trim() || undefined
  const port = Number(read("PORT") ?? 1025)
  const user = read("USER")
  const pass = env[`${prefix}_PASSWORD`] ?? env[`${prefix}_PASS`]
  return {
    host: read("HOST") ?? "localhost",
    port,
    secure: port === 465,
    ...(user && pass ? { auth: { user, pass } } : {}),
    from: read("FROM") ?? defaultFrom,
    ...(read("REPLY_TO") ? { replyTo: read("REPLY_TO") } : {}),
  }
}

/**
 * The one way an app's mail leaves it: `send` renders the message in the
 * app's theme and hands it to SMTP. It throws when the server refuses or
 * cannot be reached; a caller that must not fail on mail catches.
 */
export function createMailer({
  prefix,
  defaultFrom,
  theme,
  env = process.env,
}: {
  /** The env-var prefix: "SMTP", "STUDYGUILD_SMTP", "GHOSTHOST_SMTP". */
  prefix: string
  defaultFrom: string
  theme: EmailTheme | (() => EmailTheme)
  env?: Record<string, string | undefined>
}) {
  let transporter: Transporter | undefined

  const settings = () => smtpSettings(prefix, { defaultFrom, env })

  return {
    settings,
    /** Whether an SMTP host was configured (a production boot can warn otherwise). */
    configured: () => Boolean(env[`${prefix}_HOST`]?.trim()),
    async send({
      to,
      subject,
      headers,
      replyTo,
      ...content
    }: SendEmailOptions): Promise<void> {
      const s = settings()
      transporter ??= nodemailer.createTransport({
        host: s.host,
        port: s.port,
        secure: s.secure,
        ...(s.auth ? { auth: s.auth } : {}),
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      })
      const { html, text } = renderEmail(
        content,
        typeof theme === "function" ? theme() : theme,
      )
      await transporter.sendMail({
        from: s.from,
        to,
        replyTo: replyTo ?? s.replyTo,
        subject,
        text,
        html,
        ...(headers ? { headers } : {}),
      })
    },
  }
}
