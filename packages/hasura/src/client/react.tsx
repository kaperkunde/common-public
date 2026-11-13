import { ApolloProvider } from "@apollo/client"
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

export type HasuraConnectionState = {
  connection: UserConnection
  /** True once the socket has given up. */
  lost: boolean
  /** True while `refreshSession` is running after a return. */
  returning: boolean
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
  refreshBeforeMs?: number
  /** Drawn in place of everything when the socket has gone. */
  renderLost: (props: LostProps) => ReactNode
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
        refreshBeforeMs: props.refreshBeforeMs,
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
  const returnToConnection = useCallback(() => {
    setReturning(true)
    const done = () => {
      dropClient(key)
      setAttempt((count) => count + 1)
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

  const state = useMemo(
    () => ({ connection, lost, returning, returnToConnection }),
    [connection, lost, returning, returnToConnection],
  )

  return (
    <Context.Provider value={state}>
      {lost ? (
        renderLost({ onReturn: returnToConnection, returning })
      ) : (
        <ApolloProvider client={connection.client}>{children}</ApolloProvider>
      )}
    </Context.Provider>
  )
}
