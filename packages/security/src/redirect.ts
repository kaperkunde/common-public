/**
 * Keeps post-login redirects on this site. Only a plain absolute path is
 * accepted: no scheme, no `//host`, and no backslash anywhere, because URL
 * parsing treats `/\evil.com` exactly like `//evil.com`. Control characters
 * are refused too: browsers strip a tab or newline inside a URL, so
 * `/<tab>/evil.com` would become `//evil.com`.
 */
export function safeCallbackUrl(
  callbackUrl: string | readonly string[] | null | undefined,
  fallback = "/",
): string {
  if (typeof callbackUrl !== "string" || !callbackUrl) return fallback

  const trimmed = callbackUrl.trim()

  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return fallback
  }

  return trimmed
}
