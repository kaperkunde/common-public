import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
  split,
  type NormalizedCacheObject,
} from "@apollo/client"
import { setContext } from "@apollo/client/link/context"
import { onError } from "@apollo/client/link/error"
import { GraphQLWsLink } from "@apollo/client/link/subscriptions"
import { getMainDefinition } from "@apollo/client/utilities"
import { createClient, type Client } from "graphql-ws"

import { isConnectionLost } from "./lost"
import type { PageSignals } from "./page"
import { isAuthClose, type ReconnectPolicy } from "./reconnect"
import {
  createResilientSocket,
  type ReconnectStatus,
  type ResilientSocket,
} from "./resilient-socket"
import { createTokenSource, type TokenSource } from "./token-source"

/** `https://h/v1/graphql` becomes `wss://h/v1/graphql`. */
export const toWebSocketUrl = (url: string): string =>
  url.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://")

export type UserClientOptions = {
  /** The HTTP GraphQL endpoint. */
  endpoint: string
  /** The websocket endpoint. Defaults to `endpoint` with its scheme swapped. */
  wsEndpoint?: string
  /**
   * Returns a current token. Called per request, per socket (re)connect, and
   * again `refreshBeforeMs` before the last token expires, so the app's own
   * session code decides where tokens come from.
   */
  getToken: () => Promise<string> | string
  /** The role sent as `X-Hasura-Role`. */
  role: string
  /**
   * Tries at getting a dropped socket back once the page is visible, before
   * `onConnectionLost` fires. Default 5, within `reconnect.budgetMs` (15s).
   * Shorthand for `reconnect.maxAttempts`.
   */
  wsRetries?: number
  /** How a dropped socket is tried again; see `./reconnect`. */
  reconnect?: Partial<ReconnectPolicy>
  /** The page's visibility and return events. The browser's by default. */
  page?: PageSignals
  refreshBeforeMs?: number
  /** The Apollo cache; a fresh one by default. */
  cache?: InMemoryCache
}

/** One client, the socket under it, and what it takes to let go. */
export type UserConnection = {
  // The cache's shape is Apollo's business.
  client: ApolloClient<NormalizedCacheObject>
  /** The socket, wrapped so its subscriptions survive it dropping. */
  socket: ResilientSocket
  /** Down and being tried again by itself, given up, or fine. */
  status: () => ReconnectStatus
  /** Be told when the status changes. Returns the way to stop. */
  onStatus: (listener: (status: ReconnectStatus) => void) => () => void
  tokens: TokenSource
  /** Be told when the socket has given up for good. Returns the way to stop. */
  onConnectionLost: (watcher: () => void) => () => void
  /** Closes the socket and stops refreshing. */
  dispose: () => void
}

/**
 * An Apollo client over HTTP (queries, mutations) and graphql-ws
 * (subscriptions) whose token comes from `getToken`: requested for every
 * HTTP request and socket connect, and renewed before it expires, when the
 * socket is reconnected with the new one.
 */
export const createUserClient = (
  options: UserClientOptions,
): UserConnection => {
  const watchers = new Set<() => void>()
  const held: { socket?: Client } = {}
  const tokens = createTokenSource({
    getToken: options.getToken,
    refreshBeforeMs: options.refreshBeforeMs,
    // A socket already open holds the old token in its connection params; a
    // terminate makes graphql-ws reconnect and resubscribe with the new one.
    onChange: () => held.socket?.terminate(),
  })
  const headersFor = (token: string) => ({
    "X-Hasura-Role": options.role,
    Authorization: `Bearer ${token}`,
  })

  const socket = createResilientSocket({
    client: createClient({
      url: options.wsEndpoint ?? toWebSocketUrl(options.endpoint),
      lazy: true,
      // The tries are the wrapper's: they wait while the page is hidden, and
      // a subscription keeps its data while they run.
      retryAttempts: 0,
      connectionParams: async () => ({
        headers: headersFor(await tokens.get()),
      }),
    }),
    policy: {
      ...(options.wsRetries === undefined
        ? {}
        : { maxAttempts: options.wsRetries }),
      ...options.reconnect,
    },
    page: options.page,
    // A token that was refused is replaced before the next try; one that is
    // merely old is replaced by `tokens.get` as the socket connects.
    prepare: async (cause) => {
      await (isAuthClose(cause) ? tokens.refresh() : tokens.get())
    },
  })

  held.socket = socket

  const http = setContext(async (_, previous) => ({
    headers: {
      ...(previous as { headers?: Record<string, string> }).headers,
      ...headersFor(await tokens.get()),
    },
  })).concat(new HttpLink({ uri: options.endpoint }))

  const link = split(
    ({ query }) => {
      const main = getMainDefinition(query)
      return (
        main.kind === "OperationDefinition" && main.operation === "subscription"
      )
    },
    new GraphQLWsLink(socket),
    http,
  )

  const noticeLost = onError(({ networkError }) => {
    if (isConnectionLost(networkError)) watchers.forEach((watch) => watch())
  })

  const client = new ApolloClient({
    link: ApolloLink.from([noticeLost, link]),
    cache: options.cache ?? new InMemoryCache(),
  })

  return {
    client,
    socket,
    status: socket.status,
    onStatus: socket.onStatus,
    tokens,
    onConnectionLost: (watcher) => {
      watchers.add(watcher)
      return () => {
        watchers.delete(watcher)
      }
    },
    dispose: () => {
      tokens.dispose()
      watchers.clear()
      void socket.dispose()
    },
  }
}

const connections = new Map<string, UserConnection>()

export type ConnectionKey = {
  endpoint: string
  role: string
  /** Tells apart sessions sharing an endpoint and a role (a user id). */
  cacheKey?: string
}

const keyOf = ({ endpoint, role, cacheKey }: ConnectionKey) =>
  `${endpoint}|${role}|${cacheKey ?? ""}`

/** The cached connection for this endpoint, role and cache key, built on first use. */
export const getUserConnection = (
  options: UserClientOptions & { cacheKey?: string },
) => {
  const key = keyOf(options)
  const held = connections.get(key)
  if (held) return held
  const made = createUserClient(options)
  connections.set(key, made)
  return made
}

/**
 * Forgets a cached connection and closes its socket, so the next call builds
 * both again. A client that has given up carries the retries it has spent.
 */
export const dropClient = (key: ConnectionKey): void => {
  const id = keyOf(key)
  const held = connections.get(id)
  if (!held) return
  connections.delete(id)
  held.dispose()
}
