/**
 * Reading what an app sent from Mailpit's API, for end-to-end tests. No test
 * framework is assumed: `waitFor` polls on its own and throws with what it
 * was waiting for.
 */

type Summary = { ID: string; Subject: string; Created: string }

export type MailpitMessage = {
  ID: string
  Subject: string
  Text: string
  HTML: string
}

export function mailpit(
  url: string = process.env.MAILPIT_URL ?? "http://localhost:8025",
) {
  const base = url.replace(/\/+$/, "")
  const query = (to: string, subject?: string) =>
    encodeURIComponent(`to:"${to}"${subject ? ` subject:"${subject}"` : ""}`)

  async function search(to: string, subject?: string): Promise<Summary[]> {
    const response = await fetch(
      `${base}/api/v1/search?query=${query(to, subject)}`,
    )
    const body = (await response.json()) as { messages?: Summary[] }
    return body.messages ?? []
  }

  return {
    /** Deletes every message to these addresses: a clean inbox per run. */
    async clear(addresses: readonly string[]): Promise<void> {
      for (const to of addresses) {
        await fetch(`${base}/api/v1/search?query=${query(to)}`, {
          method: "DELETE",
        })
      }
    },

    /** How many messages to `to` with exactly `subject` arrived since `since`. */
    async count({
      to,
      subject,
      since,
    }: {
      to: string
      subject: string
      since?: Date
    }): Promise<number> {
      return (await search(to, subject)).filter(
        (m) =>
          m.Subject === subject && (!since || new Date(m.Created) >= since),
      ).length
    },

    /** The newest message to `to` whose subject contains `subject`, since `since`, waited for. */
    async waitFor({
      to,
      subject,
      since,
      timeoutMs = 30_000,
      intervalMs = 500,
    }: {
      to: string
      subject: string
      since?: Date
      timeoutMs?: number
      intervalMs?: number
    }): Promise<MailpitMessage> {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const found = (await search(to, subject)).find(
          (m) => !since || new Date(m.Created) >= since,
        )
        if (found) {
          const response = await fetch(`${base}/api/v1/message/${found.ID}`)
          return (await response.json()) as MailpitMessage
        }
        if (Date.now() > deadline) {
          throw new Error(
            `No email "${subject}" to ${to} arrived in Mailpit within ${timeoutMs} ms`,
          )
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
      }
    },
  }
}

/** The call to action: the first http(s) link of a message's text part. */
export function firstLink(text: string): string {
  const match = /https?:\/\/[^\s]+/.exec(text)
  if (!match) throw new Error(`No link in:\n${text}`)
  return match[0]
}
