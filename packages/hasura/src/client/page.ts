import type { PageState } from "./reconnect"

/** Why the page came back to the reader. */
export type ReturnKind = "visible" | "pageshow" | "online" | "focus"

/** The page as a connection needs it: whether it shows, and being told when it comes back. */
export type PageSignals = {
  state: () => PageState
  /** Called on every return event, and with "hidden" when the page goes away. Returns the way to stop. */
  watch: (listener: (kind: ReturnKind | "hidden") => void) => () => void
}

/** A page that is always there: for servers, tests and anything without a document. */
export const alwaysVisible: PageSignals = {
  state: () => ({ visible: true, online: true }),
  watch: () => () => undefined,
}

/**
 * The browser's own: `visibilitychange`, `pageshow` (a restore from the
 * back-forward cache included), `online` and `focus`. Falls back to
 * {@link alwaysVisible} where there is no `document`.
 */
export const browserPage = (): PageSignals => {
  if (typeof document === "undefined" || typeof window === "undefined")
    return alwaysVisible
  return {
    state: () => ({
      visible: document.visibilityState !== "hidden",
      online: typeof navigator === "undefined" || navigator.onLine !== false,
    }),
    watch: (listener) => {
      const onVisibility = () =>
        listener(document.visibilityState === "hidden" ? "hidden" : "visible")
      const onPageShow = () => listener("pageshow")
      const onOnline = () => listener("online")
      const onFocus = () => listener("focus")
      document.addEventListener("visibilitychange", onVisibility)
      window.addEventListener("pageshow", onPageShow)
      window.addEventListener("online", onOnline)
      window.addEventListener("focus", onFocus)
      return () => {
        document.removeEventListener("visibilitychange", onVisibility)
        window.removeEventListener("pageshow", onPageShow)
        window.removeEventListener("online", onOnline)
        window.removeEventListener("focus", onFocus)
      }
    },
  }
}
