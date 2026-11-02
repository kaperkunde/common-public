/** One password rule for sign-up, reset and change-password forms. */
export function validatePassword(
  password: string,
  verify: string,
  { minLength = 8 }: { minLength?: number } = {},
): string | null {
  if (password.length < minLength)
    return `Password must be at least ${minLength} characters.`
  if (password !== verify) return "Passwords do not match."
  return null
}

/** Query parameter carrying the account's address on the password-reset link. */
export const RESET_PASSWORD_EMAIL_PARAM = "email"

/**
 * Adds the account's address to the callback on a Better Auth reset link,
 * so the form can sign the person in once the new password is set. The
 * address comes from the user row Better Auth resolved, never from whoever
 * asked, so a caller's redirectTo cannot put someone else's address on it.
 */
export function withResetPasswordEmail(url: string, email: string): string {
  try {
    const link = new URL(url)
    const callback = new URL(
      link.searchParams.get("callbackURL") || "/reset-password",
      link.origin,
    )
    callback.searchParams.set(RESET_PASSWORD_EMAIL_PARAM, email)
    link.searchParams.set(
      "callbackURL",
      `${callback.pathname}${callback.search}`,
    )
    return link.toString()
  } catch {
    return url
  }
}

export const UNEXPECTED_ERROR =
  "Something went wrong on our side. Try again in a minute."

type AuthError = {
  code?: string
  message?: string
  status?: number
  error?: string
}

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Wrong email or password.",
  USER_ALREADY_EXISTS:
    "An account with this email already exists. Sign in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "An account with this email already exists. Sign in instead.",
  PASSWORD_TOO_SHORT: "Use at least 8 characters for your password.",
  PASSWORD_TOO_LONG: "That password is too long. Use at most 128 characters.",
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_PASSWORD: "Your current password is wrong.",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "This account has no password to change.",
  INVALID_TOKEN:
    "This link has expired or was already used. Ask for a new one.",
  EMAIL_NOT_VERIFIED: "Confirm your email address first: we sent you a link.",
}

/**
 * Better Auth answers with codes; people read sentences. A server error is
 * always the unexpected-error sentence, never Better Auth's own message.
 * `overrides` lets an app word a code its own way.
 */
export function authErrorMessage(
  error: AuthError | null | undefined,
  fallback: string,
  overrides: Readonly<Record<string, string>> = {},
): string {
  if (!error) return fallback
  if (error.status === 429)
    return "Too many attempts. Wait a minute and try again."
  if (error.status !== undefined && error.status >= 500) return UNEXPECTED_ERROR
  const code = error.code ?? ""
  if (overrides[code]) return overrides[code]
  if (MESSAGES[code]) return MESSAGES[code]
  if (error.error === "invalid_signature" || code === "INVALID_SIGNATURE") {
    return "This request to connect an app has expired. Go back to the app and start connecting again."
  }
  return fallback
}

/** Where an authorization continues after signing in for a connecting app, if it does. */
export function oauthRedirectFrom(data: unknown): string | null {
  if (!data || typeof data !== "object") return null
  const record = data as {
    redirect?: unknown
    url?: unknown
    redirect_uri?: unknown
  }
  const url = typeof record.url === "string" ? record.url : record.redirect_uri
  return typeof url === "string" &&
    (record.redirect === true || record.redirect_uri)
    ? url
    : null
}
