import { ApolloProvider, InMemoryCache } from "@apollo/client"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import {
  dropClient,
  getUserConnection,
  type UserConnection,
} from "./connection"
import { browserPage, type PageSignals } from "./page"
import { isNewReturn, type ReconnectPolicy } from "./reconnect"

export type HasuraConnectionState = {
  connection: UserConnection
  /** True once the socket has given up. */
  lost: boolean
  /** True while `refreshSession` is running after a return. */
  returning: boolean
  /** True while a dropped socket is being tried again by itself (the screen stays). */
  reconnecting: boolean
  /** Refresh the session, rebuild the client and socket, and carry on. */
  returnToConnection: () => void
}

const Context = createContext<HasuraConnectionState | null>(null)

/** The live connection under a {@link WithHasura}. */
export const useHasuraConnection = (): HasuraConnectionState => {
  const state = useContext(Context)
  if (!state)
    throw new Error("useHasuraConnection needs a <WithHasura> above it")
  return state
}

export type LostProps = { onReturn: () => void; returning: boolean }

export type WithHasuraProps = {
  endpoint: string
  wsEndpoint?: string
  role: string
  /** The current Hasura token from the app's session, or null while there is none. */
  token: string | null | undefined
  /**
   * Fetches a fresh token (refreshing the session). Called before the held
   * token expires and when the reader returns after a lost connection.
   * Defaults to handing back `token`.
   */
  refreshSession?: () => Promise<string | null | undefined>
  /** Tells sessions apart in the client cache, usually the user id. */
  cacheKey?: string
  wsRetries?: number
  reconnect?: Partial<ReconnectPolicy>
  refreshBeforeMs?: number
  /** The page's visibility and return events. The browser's by default. */
  page?: PageSignals
  /**
   * Drawn in place of everything when the socket has gone and trying again by
   * itself has not brought it back. A return to the page (visible again, back
   * online) presses its button by itself once.
   */
  renderLost: (props: LostProps) => ReactNode
  /**
   * Drawn beside the children (never in place of them) while a dropped socket
   * is tried again by itself: a small "Reconnecting…", say. Shown only once
   * it has taken longer than `reconnectingAfterMs` (default 1s).
   */
  renderReconnecting?: () => ReactNode
  reconnectingAfterMs?: number
  /** Drawn while there is no token. */
  fallback?: ReactNode
  children: ReactNode
}

/**
 * Provides an Apollo client for the session's token. The token and the
 * session refresh come in as props, so the app's auth library stays its own.
 * A socket that has given up draws `renderLost` over the whole subtree.
 */
export const WithHasura = (props: WithHasuraProps) => {
  const { token, fallback = null } = props
  if (!token) return <>{fallback}</>
  return <Connected {...props} token={token} />
}

const Connected = (props: WithHasuraProps & { token: string }) => {
  const { token, refreshSession, renderLost, children } = props
  const latest = useRef(token)
  const refresh = useRef(refreshSession)
  // Latest props are read at call time so the client survives token changes.
  useEffect(() => {
    latest.current = token
    refresh.current = refreshSession
  })
  const [attempt, setAttempt] = useState(0)
  const [lost, setLost] = useState(false)
  const [returning, setReturning] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  // One cache for every client this session builds, so a rebuilt client
  // starts from what the last one knew.
  const [cache] = useState(() => new InMemoryCache())
  const [page] = useState(() => props.page ?? browserPage())

  const key = useMemo(
    () => ({
      endpoint: props.endpoint,
      role: props.role,
      cacheKey: `${props.cacheKey ?? ""}#${attempt}`,
    }),
    [props.endpoint, props.role, props.cacheKey, attempt],
  )
  const connection = useMemo(
    () =>
      getUserConnection({
        ...key,
        wsEndpoint: props.wsEndpoint,
        role: props.role,
        wsRetries: props.wsRetries,
        reconnect: props.reconnect,
        refreshBeforeMs: props.refreshBeforeMs,
        page,
        cache,
        getToken: async () => {
          const fresh = await refresh.current?.()
          if (fresh) latest.current = fresh
          return latest.current
        },
      }),
    [key],
  )

  // A new token from the session reaches the open socket.
  useEffect(() => {
    connection.tokens.set(token)
  }, [connection, token])
  useEffect(
    () => connection.onConnectionLost(() => setLost(true)),
    [connection],
  )
  // A quiet indicator, and only for a reconnect that takes a moment.
  const indicateAfter = props.reconnectingAfterMs ?? 1_000
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const show = (status: ReturnType<UserConnection["status"]>) => {
      if (timer) clearTimeout(timer)
      timer = undefined
      if (status.kind !== "reconnecting") return setReconnecting(false)
      timer = setTimeout(() => setReconnecting(true), indicateAfter)
    }
    show(connection.status())
    const stop = connection.onStatus(show)
    return () => {
      stop()
      if (timer) clearTimeout(timer)
    }
  }, [connection, indicateAfter])
  const returningRef = useRef(false)
  const returnToConnection = useCallback(() => {
    if (returningRef.current) return
    returningRef.current = true
    setReturning(true)
    const done = () => {
      dropClient(key)
      setAttempt((count) => count + 1)
      returningRef.current = false
      setReturning(false)
      setLost(false)
    }
    Promise.resolve(refresh.current?.())
      .then((fresh) => {
        if (fresh) latest.current = fresh
      })
      .catch(() => undefined)
      .then(done)
  }, [key])

  // The manual screen is for a reader who is here: coming back to it (the
  // page shown again, the network back) presses its button once by itself,
  // so a tab that gave up in the background does not greet them with it.
  useEffect(() => {
    if (!lost) return
    let last: number | null = null
    return page.watch((kind) => {
      if (kind !== "visible" && kind !== "online" && kind !== "pageshow") return
      const state = page.state()
      if (!state.visible || !state.online) return
      const at = Date.now()
      if (!isNewReturn(last, at)) return
      last = at
      returnToConnection()
    })
  }, [lost, page, returnToConnection])

  const state = useMemo(
    () => ({
      connection,
      lost,
      returning,
      reconnecting: reconnecting && !lost,
      returnToConnection,
    }),
    [connection, lost, returning, reconnecting, returnToConnection],
  )

  return (
    <Context.Provider value={state}>
      {lost ? (
        renderLost({ onReturn: returnToConnection, returning })
      ) : (
        <ApolloProvider client={connection.client}>
          {reconnecting && props.renderReconnecting
            ? props.renderReconnecting()
            : null}
          {children}
        </ApolloProvider>
      )}
    </Context.Provider>
  )
}
