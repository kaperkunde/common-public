/** The variables every package accepts, with the defaults that exist. */
export const STANDARD_VARS = {
  prefix: "",
  owner_table: undefined,
  owner_id_column: undefined,
  owner_id_type: undefined,
  server_role: undefined,
  user_role: undefined,
  schema: "public",
} as const satisfies Record<string, string | undefined>

export class TemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TemplateError"
  }
}

const VARIABLE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/**
 * Renders `{{var}}` placeholders and nothing else. A name nobody declared is
 * a hard error, as is a declared one with no value and any stray `{{`.
 *
 * @param declared every name the package accepts
 * @param values   the value of each name that has one
 * @param where    what is being rendered, for the error message
 */
export const renderTemplate = (
  text: string,
  declared: ReadonlySet<string>,
  values: Readonly<Record<string, string>>,
  where: string,
): string => {
  const out = text.replace(VARIABLE, (_match, name: string) => {
    if (!declared.has(name)) {
      throw new TemplateError(`${where}: unknown variable {{${name}}}`)
    }
    const value = values[name]
    if (value === undefined) {
      throw new TemplateError(
        `${where}: variable {{${name}}} has no value (set it under "vars" in kaperkunde.json)`,
      )
    }
    return value
  })
  const stray = out.indexOf("{{")
  if (stray !== -1) {
    const line = out.slice(0, stray).split("\n").length
    throw new TemplateError(`${where}: malformed placeholder on line ${line}`)
  }
  return out
}
