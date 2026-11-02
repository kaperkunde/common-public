/** An address as compared: trimmed and lower case. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** A comma-separated list of addresses (an ADMIN_EMAILS setting), normalized. */
export function parseEmailList(raw: string | null | undefined): Set<string> {
  return new Set((raw ?? "").split(",").map(normalizeEmail).filter(Boolean))
}

/**
 * Whether a user is an admin: their address is one of `admins`, and it is
 * verified. An account can be made for any address at all, so an unverified
 * one proves nothing about who holds it. No admins named means nobody is
 * one, which is the safe way round.
 */
export function isAdmin(
  user:
    | { email?: string | null; emailVerified?: boolean | null }
    | null
    | undefined,
  admins: string | Iterable<string> | null | undefined,
): boolean {
  if (!user?.email || !user.emailVerified || !admins) return false
  const list =
    typeof admins === "string"
      ? parseEmailList(admins)
      : new Set([...admins].map(normalizeEmail))
  return list.has(normalizeEmail(user.email))
}
