/**
 * Which model does which piece of an app's AI.
 *
 * The caller names the roles it has and the model families each suits
 * (`modelRoles({ storyteller: [], checker: ["haiku", "sonnet"] })`); an admin's
 * per-role row picks a model, a role with none falls to a family it suits (the
 * first offered model whose name contains it), then to the owner's own model.
 * A model a row names but is no longer offered is passed over as if unset.
 *
 * Pure: the rows, the offered models and the owner's choice come in, a model
 * goes out.
 */

/** What an admin has said about one role; either half may be unset. */
export type RoleSetting<R extends string = string> = {
  role: R
  model?: string | null
  fallbackModel?: string | null
}

export type RoleModel = {
  model: string
  /** The one to ask if that one fails, where there is one different from it. */
  fallback?: string
  /** Where the answer came from. */
  from: "admin" | "family" | "owner"
}

export type RoleModelInput<R extends string> = {
  ownerModel: string
  settings: readonly RoleSetting<R>[]
  /** Every model that may be asked. */
  offered: readonly string[]
}

export type ModelRoles<R extends string> = {
  roles: readonly R[]
  families: Readonly<Record<R, readonly string[]>>
  /** The model one role runs on. */
  modelForRole: (role: R, input: RoleModelInput<R>) => RoleModel
  /** What an admin panel's "Default" shows for a role, and what it would fall back to once `chosen` is set. */
  roleDefaults: (
    role: R,
    chosen: string | null | undefined,
    offered: readonly string[],
  ) => { model: string; fallback: string }
}

export const modelRoles = <R extends string>(
  families: Readonly<Record<R, readonly string[]>>,
): ModelRoles<R> => {
  const roles = Object.keys(families) as R[]
  const modelForRole: ModelRoles<R>["modelForRole"] = (
    role,
    { ownerModel, settings, offered },
  ) => {
    const usable = (model?: string | null) =>
      model && offered.includes(model) ? model : undefined
    const row = settings.find((setting) => setting.role === role)
    const chosen = usable(row?.model)
    const found = (families[role] ?? [])
      .map((name) =>
        offered.find((model) => model.toLowerCase().includes(name)),
      )
      .filter((model): model is string => Boolean(model))
    const fallbackOf = (model: string) => {
      const fallback =
        usable(row?.fallbackModel) ??
        found.find((one) => one !== model) ??
        (model === ownerModel ? undefined : ownerModel)
      return fallback && fallback !== model ? fallback : undefined
    }
    if (chosen)
      return { model: chosen, fallback: fallbackOf(chosen), from: "admin" }
    const family = found[0]
    if (family)
      return { model: family, fallback: fallbackOf(family), from: "family" }
    return {
      model: ownerModel,
      fallback: fallbackOf(ownerModel),
      from: "owner",
    }
  }
  const roleDefaults: ModelRoles<R>["roleDefaults"] = (
    role,
    chosen,
    offered,
  ) => {
    const base = modelForRole(role, { ownerModel: "", settings: [], offered })
    const picked = modelForRole(role, {
      ownerModel: "",
      settings: chosen ? [{ role, model: chosen }] : [],
      offered,
    })
    return {
      model: base.model || "the owner's model",
      fallback:
        picked.fallback || (picked.model ? "the owner's model" : "none"),
    }
  }
  return { roles, families, modelForRole, roleDefaults }
}

/**
 * Every model a person's AI may ask: the deployment's (as far as `priced`
 * lists them, when the app charges per model) and the person's own, each only
 * where the person's order lets that back end serve.
 */
export const offeredModels = ({
  deployment,
  priced,
  own,
  sequence,
}: {
  deployment: readonly string[]
  /** Models the app has a price for; omit when everything the deployment lists is offered. */
  priced?: readonly string[]
  own?: readonly string[]
  sequence: readonly ("hosted" | "own")[]
}) =>
  [
    ...(sequence.includes("hosted")
      ? deployment.filter((model) => !priced || priced.includes(model))
      : []),
    ...(sequence.includes("own") ? (own ?? []) : []),
  ].filter((model, index, all) => all.indexOf(model) === index)
