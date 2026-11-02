/**
 * A slug: letters and digits from `text` with accents taken off, everything
 * else a single `separator`, trimmed, lower case, at most `maxLength`.
 */
export function slugify(
  text: string,
  {
    separator = "-",
    maxLength = 64,
  }: { separator?: string; maxLength?: number } = {},
): string {
  const escaped = separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^${escaped}+|${escaped}+$`, "g"), "")
    .slice(0, maxLength)
    .replace(new RegExp(`${escaped}+$`), "")
}

/** `base`, or `base_2`, `base_3` … whichever is not yet taken. */
export function uniqueSlug(
  base: string,
  taken: Iterable<string>,
  separator = "_",
): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}${separator}${n}`
    if (!used.has(candidate)) return candidate
  }
}

/** "1 card", "2 cards", "1,204 cards". Pass `plural` for an irregular word. */
export function plural(
  count: number,
  singular: string,
  pluralWord = `${singular}s`,
  locale = "en-US",
): string {
  return `${count.toLocaleString(locale)} ${count === 1 ? singular : pluralWord}`
}

/** "First L." from a full name; the name itself when it is one word. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return parts[0] ?? ""
  const last = parts[parts.length - 1] ?? ""
  return `${parts[0]} ${last.charAt(0).toUpperCase()}.`
}
