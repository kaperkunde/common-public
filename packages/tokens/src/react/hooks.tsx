"use client"

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

import { createTokenApi, type TokenApi } from "../browser-api"
import { TokenCenterError, centerUnavailable } from "../errors"
import type {
  AppInfo,
  AutoRefill,
  Balance,
  CallsPage,
  CallsQuery,
  HistoryPage,
  OwnEndpoint,
  SalePrices,
} from "../types"
import { mergeLabels, type LabelOverrides, type Labels } from "./labels"

type TokensContextValue = {
  api: TokenApi
  labels: LabelOverrides | undefined
  locale: string | undefined
}
const Context = createContext<TokensContextValue | null>(null)

export type TokensProviderProps = {
  /** Where the app mounted `tokenRoutes`. Default `/api/tokens`. */
  basePath?: string
  /** Bring your own client (tests, a custom fetch). */
  api?: TokenApi
  labels?: LabelOverrides
  /** For dates and numbers (default: the browser's). */
  locale?: string
  children: ReactNode
}

/** Gives every component below it the app's client, labels and locale. Optional: each component also works alone with `/api/tokens`. */
export function TokensProvider({
  basePath,
  api,
  labels,
  locale,
  children,
}: TokensProviderProps) {
  const value = useMemo(
    () => ({
      api: api ?? createTokenApi({ basePath }),
      labels,
      locale,
    }),
    [api, basePath, labels, locale],
  )
  return <Context.Provider value={value}>{children}</Context.Provider>
}

const fallback: TokensContextValue = {
  api: createTokenApi(),
  labels: undefined,
  locale: undefined,
}

/** The client: from `basePath` if given, else the provider's, else `/api/tokens`. */
export function useTokenApi(basePath?: string): TokenApi {
  const context = useContext(Context)
  return useMemo(
    () =>
      basePath ? createTokenApi({ basePath }) : (context?.api ?? fallback.api),
    [basePath, context],
  )
}

export function useLabels(overrides?: LabelOverrides): Labels {
  const context = useContext(Context)
  return useMemo(
    () => mergeLabels(context?.labels, overrides),
    [context, overrides],
  )
}

export const useLocale = (): string | undefined => useContext(Context)?.locale

const REFRESH_EVENT = "tokens:refresh"

/** Ask every mounted `useBalance`/`useCalls`/… to load again (after a purchase, a spend you made yourself). */
export function refreshTokens(): void {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(REFRESH_EVENT))
}

export type Resource<T> = {
  data: T | undefined
  error: TokenCenterError | undefined
  loading: boolean
  refresh: () => Promise<void>
}

export type ResourceOptions = {
  /** Poll while the tab is visible, in ms. 0 or unset: no polling. */
  refreshMs?: number
  /** Skip loading (a value the caller already has). */
  skip?: boolean
}

/** Load something now, on `key` changes, every `refreshMs` while visible, on focus, and on `refreshTokens()`. */
export function useResource<T>(
  load: () => Promise<T>,
  key: string,
  options: ResourceOptions = {},
): Resource<T> {
  const [state, setState] = useState<{
    data: T | undefined
    error: TokenCenterError | undefined
    loading: boolean
  }>({ data: undefined, error: undefined, loading: !options.skip })
  const loader = useRef(load)
  loader.current = load
  const serial = useRef(0)
  const alive = useRef(true)
  const skipped = useRef(options.skip)
  skipped.current = options.skip

  const refresh = useCallback(async () => {
    // Data the caller supplies is the caller's to refresh.
    if (skipped.current) return
    const mine = ++serial.current
    try {
      const data = await loader.current()
      if (alive.current && mine === serial.current)
        setState({ data, error: undefined, loading: false })
    } catch (error) {
      if (alive.current && mine === serial.current)
        setState((s) => ({
          data: s.data,
          error:
            error instanceof TokenCenterError
              ? error
              : centerUnavailable(error),
          loading: false,
        }))
    }
  }, [])

  const { refreshMs, skip } = options
  useEffect(() => {
    alive.current = true
    if (skip) {
      setState((s) => (s.loading ? { ...s, loading: false } : s))
      return
    }
    setState((s) => (s.loading ? s : { ...s, loading: s.data === undefined }))
    void refresh()
    const again = () => {
      if (document.visibilityState !== "hidden") void refresh()
    }
    const timer = refreshMs ? setInterval(again, refreshMs) : undefined
    window.addEventListener("focus", again)
    document.addEventListener("visibilitychange", again)
    window.addEventListener(REFRESH_EVENT, again)
    return () => {
      alive.current = false
      if (timer) clearInterval(timer)
      window.removeEventListener("focus", again)
      document.removeEventListener("visibilitychange", again)
      window.removeEventListener(REFRESH_EVENT, again)
    }
  }, [key, refreshMs, skip, refresh])

  return { ...state, refresh }
}

type Opts = ResourceOptions & { basePath?: string }

/** The signed-in user's balance, refreshed every 30 s while the tab is showing. */
export function useBalance(options: Opts = {}): Resource<Balance> {
  const api = useTokenApi(options.basePath)
  return useResource(() => api.balance(), "balance", {
    refreshMs: 30_000,
    ...options,
  })
}

export function useAppInfo(options: Opts = {}): Resource<AppInfo> {
  const api = useTokenApi(options.basePath)
  return useResource(() => api.app(), "app", options)
}

export function useSalePrices(options: Opts = {}): Resource<SalePrices> {
  const api = useTokenApi(options.basePath)
  return useResource(() => api.salePrices(), "sale-prices", options)
}

export function useAutoRefill(options: Opts = {}): Resource<AutoRefill> {
  const api = useTokenApi(options.basePath)
  return useResource(() => api.autoRefill(), "autorefill", options)
}

/** `data` is `null` when the user has saved none. */
export function useOwnEndpoint(
  options: Opts = {},
): Resource<OwnEndpoint | null> {
  const api = useTokenApi(options.basePath)
  return useResource(() => api.ownEndpoint(), "own-endpoint", options)
}

export function useCalls(
  query: CallsQuery = {},
  options: Opts = {},
): Resource<CallsPage> {
  const api = useTokenApi(options.basePath)
  return useResource(
    () => api.calls(query),
    `calls:${JSON.stringify(query)}`,
    options,
  )
}

export function useHistory(
  query: { limit?: number } = {},
  options: Opts = {},
): Resource<HistoryPage> {
  const api = useTokenApi(options.basePath)
  return useResource(
    () => api.history(query),
    `history:${JSON.stringify(query)}`,
    options,
  )
}
