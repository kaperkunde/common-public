"use client"

import { useEffect, useState, type FormEvent } from "react"

import type {
  BackendOrder,
  Capability,
  OwnEndpoint,
  OwnEndpointInput,
  OwnEndpointTest,
  ToolChoice,
} from "../types"
import { formatCompact } from "../units"
import { refreshTokens, useLabels, useOwnEndpoint, useTokenApi } from "./hooks"
import { fill, type LabelOverrides } from "./labels"
import {
  Field,
  Notice,
  Panel,
  Segmented,
  part,
  stillNeeded,
  useAction,
  type Styling,
} from "./ui"

const ORDERS: BackendOrder[] = [
  "tokens_then_own",
  "own_then_tokens",
  "tokens_only",
  "own_only",
]
const CAPABILITIES: Capability[] = [
  "tools",
  "streaming",
  "vision",
  "json",
  "voice",
]

export type BackendOrderSwitchProps = Styling & {
  order: BackendOrder
  onChange: (order: BackendOrder) => void | Promise<unknown>
  /** Whether the user has saved an own endpoint; without one only "tokens only" is accepted. */
  hasOwn: boolean
  labels?: LabelOverrides
}

/** Which backend comes first: tokens, the user's own model, one only, or both in an order. */
export function BackendOrderSwitch(props: BackendOrderSwitchProps) {
  const labels = useLabels(props.labels)
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <>
      <Segmented<BackendOrder>
        label={labels.order}
        value={props.order}
        options={ORDERS.map((o) => ({ value: o, label: labels.orders[o] }))}
        onChange={(order) => {
          if (!props.hasOwn && order !== "tokens_only")
            return setProblem(labels.orderNeedsOwn)
          setProblem(null)
          void props.onChange(order)
        }}
        styling={props}
      />
      {problem ? (
        <Notice kind="info" styling={props}>
          {problem}
        </Notice>
      ) : null}
    </>
  )
}

export type OwnModelFormProps = Styling & {
  /** The saved endpoint (`null`: none); loaded when `undefined`. */
  endpoint?: OwnEndpoint | null
  onSave?: (input: OwnEndpointInput) => Promise<OwnEndpoint>
  onTest?: () => Promise<OwnEndpointTest>
  onRemove?: () => Promise<unknown>
  onOrder?: (order: BackendOrder) => Promise<unknown>
  /** Called with the endpoint after a save. */
  onSaved?: (endpoint: OwnEndpoint) => void
  labels?: LabelOverrides
  basePath?: string
}

const lines = (text: string) => [
  ...new Set(
    text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
]

/**
 * The user's own OpenAI-compatible endpoint: address, key (write-only), models,
 * what it can do, a monthly limit, which backend comes first, and a test.
 */
export function OwnModelForm(props: OwnModelFormProps) {
  const labels = useLabels(props.labels)
  const api = useTokenApi(props.basePath)
  const styling: Styling = props
  const loaded = useOwnEndpoint({
    basePath: props.basePath,
    skip: props.endpoint !== undefined,
  })
  const endpoint = props.endpoint !== undefined ? props.endpoint : loaded.data

  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [removeKey, setRemoveKey] = useState(false)
  const [models, setModels] = useState("")
  const [defaultModel, setDefaultModel] = useState("")
  const [caps, setCaps] = useState<Capability[]>(["streaming"])
  const [limit, setLimit] = useState("")
  const [toolChoice, setToolChoice] = useState<ToolChoice>("auto")
  const [order, setOrder] = useState<BackendOrder>("own_then_tokens")
  const [seeded, setSeeded] = useState<OwnEndpoint | null | undefined>(
    undefined,
  )
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [test, setTest] = useState<OwnEndpointTest | null>(null)
  const save = useAction(labels)
  const testing = useAction(labels)
  const removing = useAction(labels)

  useEffect(() => {
    if (endpoint === undefined || endpoint === seeded) return
    setSeeded(endpoint)
    if (endpoint) {
      setBaseUrl(endpoint.baseUrl)
      setModels(endpoint.models.join("\n"))
      setDefaultModel(endpoint.defaultModel)
      setCaps(endpoint.capabilities)
      setToolChoice(endpoint.toolChoice ?? "auto")
      setLimit(
        endpoint.monthlyTokenLimit === null
          ? ""
          : String(endpoint.monthlyTokenLimit),
      )
      setOrder(endpoint.order)
      setTest(endpoint.lastTest)
    }
  }, [endpoint, seeded])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setDone(false)
    setProblem(null)
    const modelList = lines(models)
    const need = stillNeeded(labels, [
      { label: labels.baseUrl, filled: baseUrl.trim() !== "" },
      { label: labels.models, filled: modelList.length > 0 },
    ])
    if (need) return setProblem(need)
    const input: OwnEndpointInput = {
      baseUrl: baseUrl.trim(),
      models: modelList,
      defaultModel: modelList.includes(defaultModel)
        ? defaultModel
        : modelList[0],
      capabilities: caps,
      toolChoice,
      monthlyTokenLimit:
        limit.trim() === "" ? null : Math.max(0, Math.floor(Number(limit))),
      order,
      // Omitted keeps the stored key; null removes it; a value replaces it.
      ...(removeKey ? { apiKey: null } : apiKey ? { apiKey } : {}),
    }
    const saved = await save.run(() =>
      props.onSave ? props.onSave(input) : api.saveOwnEndpoint(input),
    )
    if (saved) {
      setApiKey("")
      setRemoveKey(false)
      setDone(true)
      setSeeded(saved)
      props.onSaved?.(saved)
      loaded.refresh()
      refreshTokens()
    }
  }

  async function runTest() {
    setTest(null)
    const out = await testing.run(() =>
      props.onTest ? props.onTest() : api.testOwnEndpoint(),
    )
    if (out) setTest(out)
  }

  async function remove() {
    const out = await removing.run(async () => {
      await (props.onRemove ? props.onRemove() : api.removeOwnEndpoint())
      return true
    })
    if (out) {
      setBaseUrl("")
      setModels("")
      setDefaultModel("")
      setLimit("")
      setApiKey("")
      setTest(null)
      setSeeded(null)
      loaded.refresh()
      refreshTokens()
    }
  }

  async function changeOrder(next: BackendOrder) {
    const previous = order
    setOrder(next)
    try {
      await (props.onOrder ? props.onOrder(next) : api.setBackendOrder(next))
    } catch (error) {
      setOrder(previous)
      setProblem(error instanceof Error ? error.message : labels.somethingWrong)
    }
  }

  if (endpoint === undefined)
    return (
      <Panel title={labels.ownTitle} styling={styling}>
        {loaded.error ? (
          <Notice styling={styling}>{labels.unavailable}</Notice>
        ) : (
          <p className="tk-muted">{labels.loading}</p>
        )}
      </Panel>
    )

  const modelList = lines(models)
  return (
    <Panel title={labels.ownTitle} styling={styling}>
      <form className={part(styling, "form")} onSubmit={submit} noValidate>
        <Field
          label={labels.baseUrl}
          hint={labels.baseUrlHelp}
          required
          styling={styling}
        >
          {(p) => (
            <input
              {...p}
              className={part(styling, "input")}
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="https://"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={labels.apiKey}
          hint={
            endpoint?.hasKey
              ? fill(labels.apiKeySaved, { hint: `…${endpoint.keyHint ?? ""}` })
              : labels.apiKeyHelp
          }
          styling={styling}
        >
          {(p) => (
            <input
              {...p}
              className={part(styling, "input")}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          )}
        </Field>
        {endpoint?.hasKey ? (
          <label className={part(styling, "check")}>
            <input
              type="checkbox"
              checked={removeKey}
              onChange={(e) => setRemoveKey(e.target.checked)}
            />{" "}
            {labels.removeKey}
          </label>
        ) : null}
        <Field
          label={labels.models}
          hint={labels.modelsHelp}
          required
          styling={styling}
        >
          {(p) => (
            <textarea
              {...p}
              className={part(styling, "input", "tk-textarea")}
              rows={3}
              autoCapitalize="none"
              spellCheck={false}
              value={models}
              onChange={(e) => setModels(e.target.value)}
            />
          )}
        </Field>
        {modelList.length > 1 ? (
          <Field label={labels.defaultModel} styling={styling}>
            {(p) => (
              <select
                {...p}
                className={part(styling, "input")}
                value={
                  modelList.includes(defaultModel) ? defaultModel : modelList[0]
                }
                onChange={(e) => setDefaultModel(e.target.value)}
              >
                {modelList.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        <fieldset className={part(styling, "fieldset")}>
          <legend className={part(styling, "label")}>
            {labels.capabilities}
          </legend>
          {CAPABILITIES.map((c) => (
            <label key={c} className={part(styling, "check")}>
              <input
                type="checkbox"
                checked={caps.includes(c)}
                onChange={(e) =>
                  setCaps(
                    e.target.checked
                      ? [...caps, c]
                      : caps.filter((x) => x !== c),
                  )
                }
              />{" "}
              {labels.capability[c]}
            </label>
          ))}
        </fieldset>
        {caps.includes("tools") ? (
          <Segmented<ToolChoice>
            label={labels.toolChoice}
            value={toolChoice}
            options={(["auto", "required"] as const).map((v) => ({
              value: v,
              label: labels.toolChoices[v],
            }))}
            onChange={setToolChoice}
            styling={styling}
          />
        ) : null}
        <Field label={labels.limit} hint={labels.limitHelp} styling={styling}>
          {(p) => (
            <input
              {...p}
              className={part(styling, "input")}
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          )}
        </Field>
        {endpoint ? (
          <p className="tk-muted">
            {endpoint.monthlyTokenLimit === null
              ? fill(labels.usedNoLimit, {
                  used: formatCompact(endpoint.usedThisMonth),
                })
              : fill(labels.used, {
                  used: formatCompact(endpoint.usedThisMonth),
                  limit: formatCompact(endpoint.monthlyTokenLimit),
                })}
          </p>
        ) : null}
        <BackendOrderSwitch
          order={order}
          hasOwn={!!endpoint}
          onChange={endpoint ? changeOrder : setOrder}
          classNames={styling.classNames}
          labels={props.labels}
        />
        {problem ? <Notice styling={styling}>{problem}</Notice> : null}
        {save.error ? <Notice styling={styling}>{save.error}</Notice> : null}
        {done ? (
          <Notice kind="ok" styling={styling}>
            {labels.saved}
          </Notice>
        ) : null}
        <div className={part(styling, "actions")}>
          <button
            type="submit"
            className={part(styling, "button", "tk-button--primary")}
            aria-busy={save.pending}
            disabled={save.pending}
          >
            {save.pending ? labels.saving : labels.save}
          </button>
          {endpoint ? (
            <>
              <button
                type="button"
                className={part(styling, "button")}
                onClick={runTest}
                aria-busy={testing.pending}
              >
                {testing.pending ? labels.testing : labels.test}
              </button>
              <button
                type="button"
                className={part(styling, "button", "tk-button--danger")}
                onClick={remove}
                aria-busy={removing.pending}
              >
                {labels.remove}
              </button>
            </>
          ) : null}
        </div>
        {testing.error ? (
          <Notice styling={styling}>{testing.error}</Notice>
        ) : null}
        {removing.error ? (
          <Notice styling={styling}>{removing.error}</Notice>
        ) : null}
        {test ? (
          <Notice kind={test.ok ? "ok" : "error"} styling={styling}>
            {test.ok
              ? fill(labels.testOk, { ms: test.latencyMs ?? 0 })
              : fill(labels.testFailed, {
                  message: test.error?.message ?? labels.somethingWrong,
                })}
          </Notice>
        ) : null}
      </form>
    </Panel>
  )
}

/** The same form under the contract's name for the endpoint. */
export const OwnEndpointForm = OwnModelForm
