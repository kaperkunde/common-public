export type HasuraRole = string

/** The headers a request made on somebody's behalf carries. */
export const hasuraHeaders = (token: string, role: HasuraRole) => ({
  "X-Hasura-Role": role,
  Authorization: `Bearer ${token}`,
})

/** The headers of a request made with the admin secret, as one role. */
export const hasuraAdminHeaders = (adminSecret: string, role: HasuraRole) => ({
  "X-Hasura-Role": role,
  "X-Hasura-Admin-Secret": adminSecret,
})

export type GraphqlRequest = {
  query: string
  variables?: Record<string, unknown> | null
  operationName?: string | null
}

export type GraphqlResult = {
  status: number
  body: {
    data?: unknown
    errors?: { message: string; extensions?: Record<string, unknown> }[]
  }
}

type Fetch = typeof fetch

/** Carries one request to Hasura and its answer back, untouched. */
export const postGraphql = async (
  endpoint: string,
  headers: Record<string, string>,
  request: GraphqlRequest,
  fetchImpl: Fetch = fetch,
): Promise<GraphqlResult> => {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      query: request.query,
      variables: request.variables ?? undefined,
      operationName: request.operationName ?? undefined,
    }),
  })
  const body = (await response.json().catch(() => ({
    errors: [{ message: "Hasura answered with something that was not JSON." }],
  }))) as GraphqlResult["body"]
  return { status: response.status, body }
}

export class HasuraError extends Error {
  readonly errors: { message: string }[]
  readonly status: number
  constructor(result: GraphqlResult) {
    const errors = result.body.errors ?? []
    super(errors.map((error) => error.message).join("; ") || "Hasura failed")
    this.name = "HasuraError"
    this.errors = errors
    this.status = result.status
  }
}

export type ServerClientOptions = {
  /** Where the server reaches Hasura (an internal address is fine). */
  endpoint: string
  adminSecret: string
  /** The role requests run as. */
  role: HasuraRole
  fetch?: Fetch
}

export type ServerClient = {
  endpoint: string
  /** The raw answer, errors included. */
  request: (request: GraphqlRequest) => Promise<GraphqlResult>
  /** Runs a document and returns its data, throwing {@link HasuraError} on errors. */
  execute: <T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
    operationName?: string,
  ) => Promise<T>
}

/**
 * A server-side client: admin secret plus a named role, no cache, nothing
 * kept between calls.
 */
export const createServerClient = (
  options: ServerClientOptions,
): ServerClient => {
  if (!options.endpoint) throw new Error("createServerClient needs an endpoint")
  if (!options.adminSecret) {
    throw new Error("createServerClient needs an admin secret")
  }
  const headers = hasuraAdminHeaders(options.adminSecret, options.role)
  const request = (req: GraphqlRequest) =>
    postGraphql(options.endpoint, headers, req, options.fetch)
  return {
    endpoint: options.endpoint,
    request,
    execute: async <T>(
      query: string,
      variables?: Record<string, unknown>,
      operationName?: string,
    ) => {
      const result = await request({ query, variables, operationName })
      if (result.body.errors?.length || result.body.data === undefined) {
        throw new HasuraError(result)
      }
      return result.body.data as T
    },
  }
}

export type ForwardOptions = {
  endpoint: string
  /** The caller's own JWT. */
  token: string
  role: HasuraRole
  fetch?: Fetch
  /** Called with every answer, for tracing; never changes it. */
  onResult?: (
    request: GraphqlRequest,
    result: GraphqlResult,
    ms: number,
  ) => void
}

/**
 * The courier: a document and its variables, carried to Hasura under
 * somebody's own token and role, and the answer carried back untouched. What
 * the caller may do is Hasura's permissions to decide.
 */
export const forwardGraphql = async (
  request: GraphqlRequest,
  options: ForwardOptions,
): Promise<GraphqlResult> => {
  const started = Date.now()
  const result = await postGraphql(
    options.endpoint,
    hasuraHeaders(options.token, options.role),
    request,
    options.fetch,
  )
  options.onResult?.(request, result, Date.now() - started)
  return result
}

/** What Hasura answers in place of a database error it does not pass on. */
export const UNEXPLAINED = "database query error"

/**
 * One line for a caller whose request was refused with nothing said, or
 * undefined when every error explained itself.
 */
export const unexplainedRefusal = (
  body: GraphqlResult["body"],
  hint?: string,
): string | undefined => {
  if (!body.errors?.some((error) => error.message === UNEXPLAINED)) {
    return undefined
  }
  return `The database refused this without giving a reason.${hint ? ` ${hint}` : ""}`
}
