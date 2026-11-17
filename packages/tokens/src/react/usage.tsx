"use client"

import { useState } from "react"

import type { AppUnit, CallRecord, CallsPage, CallsQuery } from "../types"
import { formatCompact, formatUnits } from "../units"
import {
  useAppInfo,
  useCalls,
  useLabels,
  useLocale,
  useTokenApi,
} from "./hooks"
import { fill, type LabelOverrides } from "./labels"
import {
  Notice,
  Panel,
  dateTimeText,
  messageOf,
  part,
  type Styling,
} from "./ui"

export type UsageListProps = Styling & {
  /** Which calls (scope, job, purpose, since …). Default: the user's newest. */
  query?: CallsQuery
  /** A page you already hold. */
  page?: CallsPage
  pageSize?: number
  unit?: AppUnit
  /** Poll the first page, in ms. Off by default. */
  refreshMs?: number
  labels?: LabelOverrides
  basePath?: string
}

/** Share of the prompt served from cache, 0..100. */
export const cacheShare = (call: Pick<CallRecord, "usage">): number =>
  call.usage.inputTokens > 0
    ? Math.round((call.usage.cacheReadTokens / call.usage.inputTokens) * 100)
    : 0

/** What the user is shown a call as: its activity, else its purpose, else the model. */
export const callTitle = (call: CallRecord): string =>
  call.attribution.activity || call.attribution.purpose || call.model

/** The user's calls with what each cost, how much of its prompt came from cache, and what it was for. */
export function UsageList(props: UsageListProps) {
  const labels = useLabels(props.labels)
  const locale = useLocale()
  const api = useTokenApi(props.basePath)
  const styling: Styling = props
  const query = { limit: props.pageSize ?? 25, ...props.query }
  const first = useCalls(query, {
    basePath: props.basePath,
    refreshMs: props.refreshMs,
    skip: props.page !== undefined,
  })
  const app = useAppInfo({
    basePath: props.basePath,
    skip: props.unit !== undefined,
  })
  const unit = props.unit ??
    app.data?.unit ?? { one: "token", many: "tokens", perDollar: 1_000_000 }
  const [more, setMore] = useState<CallRecord[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const page = props.page ?? first.data
  const calls = [...(page?.calls ?? []), ...more]
  const next = cursor === undefined ? (page?.nextCursor ?? null) : cursor

  async function loadMore() {
    if (!next) return
    setLoadingMore(true)
    setError(null)
    try {
      const out = await api.calls({ ...query, cursor: next })
      setMore((m) => [...m, ...out.calls])
      setCursor(out.nextCursor)
    } catch (e) {
      setError(messageOf(e, labels))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <Panel title={labels.usageTitle} styling={styling}>
      {!page ? (
        first.error ? (
          <Notice styling={styling}>{labels.unavailable}</Notice>
        ) : (
          <p className="tk-muted">{labels.loading}</p>
        )
      ) : calls.length === 0 ? (
        <p className="tk-muted">{labels.usageEmpty}</p>
      ) : (
        <>
          <p className="tk-muted">
            {fill(labels.totals, {
              count: page.totals.count,
              amount: formatUnits(page.totals.chargedMicros, unit, {
                locale,
                compact: true,
              }),
            })}
          </p>
          <ul className={part(styling, "list")}>
            {calls.map((call) => (
              <li key={call.callId} className={part(styling, "row")}>
                <span className="tk-row__main">
                  <span className="tk-row__title">{callTitle(call)}</span>
                  <span className="tk-row__meta">
                    {dateTimeText(call.createdAt, locale)}
                    {call.source === "own"
                      ? ` · ${labels.yourOwn}`
                      : ` · ${call.model}`}
                    {call.status === "failed" ? ` · ${labels.failedCall}` : ""}
                  </span>
                  <span className="tk-row__meta">
                    {fill(labels.tokensInOut, {
                      input: formatCompact(call.usage.inputTokens),
                      output: formatCompact(call.usage.outputTokens),
                    })}
                    {call.usage.inputTokens > 0 &&
                    call.usage.cacheReadTokens > 0
                      ? ` · ${fill(labels.cached, { percent: cacheShare(call) })}`
                      : ""}
                  </span>
                </span>
                <span className="tk-row__amount">
                  {call.source === "own"
                    ? "—"
                    : formatUnits(call.chargedMicros, unit, {
                        locale,
                        bare: true,
                      })}
                </span>
              </li>
            ))}
          </ul>
          {error ? <Notice styling={styling}>{error}</Notice> : null}
          {next ? (
            <div className={part(styling, "actions")}>
              <button
                type="button"
                className={part(styling, "button")}
                onClick={loadMore}
                aria-busy={loadingMore}
              >
                {labels.loadMore}
              </button>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  )
}
