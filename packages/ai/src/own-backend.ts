import { NotPublicError, publicFetch } from "@kaperkunde/security/net"

import { BackendRefusedError } from "./refusal"
import {
  chooseBackend,
  finalRefusal,
  ownEndpointShape,
  normalBaseUrl,
  type BackendOrder,
  type BackendSource,
  type Chosen,
  type Verdict,
} from "./backends"
import type { ResolvedBackend } from "./provider"
import type { ToolChoiceMode } from "./config"

/** What an address the server will not send a key to is called, on the error it throws. */
const UNREACHABLE = "UnreachableEndpointError"

const unreachable = (reason: string) =>
  Object.assign(
    new Error(`Your own model's address was not called: ${reason}.`),
    { name: UNREACHABLE },
  )

/** How long one call to a person's own model may take at most. */
const OWN_CALL_TIMEOUT_MS = 15 * 60 * 1000

/**
 * The fetch a person's own endpoint is reached with. The shape of the address
 * was checked when it was saved, but a name can be pointed somewhere else
 * afterwards, so every request goes through `publicFetch`
 * (`@kaperkunde/security/net`): the name is resolved and checked as the socket
 * connects, and a redirect is refused outright. With `allowPrivate` (a
 * deployment whose people run models on its own network) the shape check still
 * applies and redirects are refused, but private addresses are reachable.
 */
export const guardedFetch =
  (allowPrivate: boolean): typeof fetch =>
  async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    )
    const shape = ownEndpointShape(url.origin, allowPrivate)
    if (!shape.ok) throw unreachable(shape.reason)
    if (allowPrivate) return fetch(input, { ...init, redirect: "error" })
    try {
      return await publicFetch(url, {
        ...(init as Parameters<typeof publicFetch>[1]),
        maxRedirects: 0,
        timeoutMs: OWN_CALL_TIMEOUT_MS,
      })
    } catch (error) {
      if (error instanceof NotPublicError) {
        throw unreachable(
          "that address is on this machine or a private network",
        )
      }
      throw error
    }
  }

export type OwnBackendInput = {
  baseUrl: string
  /** The sealed key as stored, or none when the endpoint needs no key. */
  sealedKey?: string | null
  /** Opens the sealed key. The app owns the box; the key never leaves this call. */
  openKey: (sealed: string) => string | Promise<string>
  allowPrivate: boolean
  toolChoice?: ToolChoiceMode
  providerName?: string
}

/**
 * A person's own back end as a {@link ResolvedBackend}: the address checked,
 * the key opened and handed to the provider, the fetch guarded. Throws a
 * {@link BackendRefusedError} (never fallback-worthy) if either fails.
 */
export const createOwnBackend = async (
  input: OwnBackendInput,
): Promise<ResolvedBackend> => {
  const shape = ownEndpointShape(input.baseUrl, input.allowPrivate)
  if (!shape.ok) {
    throw new BackendRefusedError(
      `Your own model's address cannot be used: ${shape.reason}.`,
      { reason: "unreachable" },
    )
  }
  let apiKey: string | undefined
  if (input.sealedKey) {
    try {
      apiKey = await input.openKey(input.sealedKey)
    } catch {
      throw new BackendRefusedError(
        "Your own model's key could not be read. Save it again.",
        { reason: "unreadable" },
      )
    }
  }
  return {
    source: "own",
    baseURL: normalBaseUrl(input.baseUrl),
    apiKey,
    toolChoice: input.toolChoice ?? "auto",
    provider: "openai-compatible",
    fetch: guardedFetch(input.allowPrivate),
    providerName: input.providerName ?? "own-model",
  }
}

/**
 * Walks a person's order and returns the first back end that can serve, or
 * throws a {@link BackendRefusedError} carrying {@link finalRefusal}'s message.
 * Each source's check is the app's own (balance, key, limit).
 */
export const resolveByOrder = async (
  order: BackendOrder | null | undefined,
  check: (
    source: BackendSource,
  ) => Verdict<ResolvedBackend> | Promise<Verdict<ResolvedBackend>>,
): Promise<Chosen<ResolvedBackend> & { ok: true }> => {
  const chosen = await chooseBackend(order, check)
  if (chosen.ok) return chosen
  const refusal = finalRefusal(chosen.refusals)
  throw new BackendRefusedError(refusal?.message ?? "No model is available.", {
    reason: refusal?.reason ?? "off",
    until: refusal?.until,
    // A model unpriced or unlisted may be served by the role's fallback.
    fallbackWorthy:
      refusal?.reason === "unlisted" || refusal?.reason === "unpriced",
  })
}
