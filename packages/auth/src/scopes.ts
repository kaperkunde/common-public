/**
 * Scopes as Better Auth stores them (an array, a space- or comma-separated
 * string, or JSON text on MySQL), as a list.
 */
export function parseScopeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string")
  }
  if (typeof value !== "string" || !value.trim()) return []
  const trimmed = value.trim()
  if (trimmed.startsWith("[")) {
    try {
      return parseScopeList(JSON.parse(trimmed))
    } catch {
      return []
    }
  }
  return trimmed.split(/[\s,]+/).filter(Boolean)
}

/**
 * What a request may do: the token's scopes, narrowed to what the person
 * still allows the app. Access tokens are self-contained and refresh tokens
 * carry their original scopes, so the consent row is the only live record:
 * checking it on every request makes Disconnect take effect at once
 * (`consented` null), and intersecting makes a downgrade take effect too.
 */
export function effectiveScopes(
  tokenScopes: unknown,
  consented: unknown | null,
): string[] | null {
  if (consented === null || consented === undefined) return null
  const allowed = new Set(parseScopeList(consented))
  return parseScopeList(tokenScopes).filter((scope) => allowed.has(scope))
}
