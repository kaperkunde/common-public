import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * A token that names one subject (a user id) and nothing else, signed so it
 * cannot be made up or edited into someone else's: for an unsubscribe link,
 * read by someone who is not signed in. The key is derived from `secret`
 * under `label`, so a token can neither be forged from, nor passed off as,
 * anything else that secret signs. There is no expiry: mail sits in inboxes
 * for years. What a token is allowed to do lives in the route that takes it.
 */
export function createLinkTokens({
  secret,
  label,
}: {
  secret: string
  label: string
}) {
  if (!secret)
    throw new Error(`createLinkTokens(${label}): the secret is empty`)

  const key = createHmac("sha256", secret).update(label).digest()
  const sign = (subject: string) =>
    createHmac("sha256", key).update(subject).digest("base64url")

  return {
    /** The token to put in a link for `subject`. */
    tokenFor(subject: string): string {
      return `${Buffer.from(subject).toString("base64url")}.${sign(subject)}`
    },
    /** Who the token is for, or undefined when it is not one of ours. */
    subjectOf(token: string): string | undefined {
      const [encoded, signature, ...rest] = token.split(".")
      if (!encoded || !signature || rest.length > 0) return undefined
      const subject = Buffer.from(encoded, "base64url").toString()
      if (!subject) return undefined
      const expected = Buffer.from(sign(subject))
      const given = Buffer.from(signature)
      if (
        expected.length !== given.length ||
        !timingSafeEqual(expected, given)
      ) {
        return undefined
      }
      return subject
    },
  }
}
