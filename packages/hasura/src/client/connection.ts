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
   * Tries at getting a dropped socket back, a second longer each time,
   * before `onConnectionLost` fires. Default 5 (about fifteen seconds).
   */
  wsRetries?: number
  refreshBeforeMs?: number
  /** The Apollo cache; a fresh one by default. */
  cache?: InMemoryCache
}

/** One client, the socket under it, and what it takes to let go. */
export type UserConnection = {
  // The cache's shape is Apollo's business.
  client: ApolloClient<NormalizedCacheObject>
  socket: Client
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
  const retries = options.wsRetries ?? 5
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

  const socket = createClient({
    url: options.wsEndpoint ?? toWebSocketUrl(options.endpoint),
    lazy: true,
    retryAttempts: retries,
    connectionParams: async () => ({ headers: headersFor(await tokens.get()) }),
    // A second longer each time: a screen that has stopped answering for half
    // a minute reads as broken rather than busy.
    retryWait: (attempt: number) =>
      new Promise((resume) => {
        setTimeout(resume, 1000 * (attempt + 1))
      }),
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
      socket.dispose()
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
