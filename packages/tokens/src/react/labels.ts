/** Every English string the components draw. Override any through `labels` on a component or the provider. */
export const DEFAULT_LABELS = {
  loading: "Loading…",
  retry: "Try again",
  unavailable: "Tokens are unavailable right now. Try again in a moment.",
  somethingWrong: "Something went wrong.",
  stillNeeded: "Still needed: {fields}.",
  // balance
  balance: "Balance",
  balanceUnknown: "Balance unavailable",
  purchased: "Bought",
  fromGrants: "From drops and grants",
  expiring: "{amount} expire {date}",
  shortfall:
    "You owe {amount} from your last calls; it comes out of your next purchase.",
  feeNote: "A token buys a little less than a dollar of model use.",
  empty: "Out of tokens",
  buyMore: "Buy tokens",
  // buy
  buyTitle: "Buy tokens",
  amount: "Amount",
  otherAmount: "Other amount",
  currency: "Currency",
  saveCard: "Save my card for auto-refill",
  buyButton: "Buy {amount}",
  buyButtonBare: "Buy",
  buying: "Opening checkout…",
  buys: "{money} buys {tokens}.",
  tax: {
    inclusive: "Price includes VAT.",
    exclusive: "Before sales tax; tax is added at checkout.",
  },
  minimum: "The smallest purchase is {money}.",
  maximum: "The largest purchase is {money}.",
  paymentsUnavailable: "Buying is not available right now.",
  // auto-refill
  autoRefillTitle: "Auto-refill",
  autoRefillOn: "Refill automatically",
  autoRefillHelp:
    "When your bought tokens fall below the threshold, your card is charged for the amount below, up to the monthly maximum.",
  threshold: "When bought tokens fall below",
  refillAmount: "Refill amount",
  monthlyMax: "Most per month",
  card: "Card",
  noCard: "No card saved",
  addCard: "Add a card",
  replaceCard: "Replace card",
  removeCard: "Remove card",
  needCardFirst: "Save a card first, then turn auto-refill on.",
  autoRefillFailed:
    "Your last refill could not be charged, so auto-refill was turned off. Check your card and turn it back on.",
  save: "Save",
  saving: "Saving…",
  saved: "Saved.",
  // usage
  usageTitle: "Recent usage",
  usageEmpty: "Nothing used yet.",
  cached: "{percent}% cached",
  tokensInOut: "{input} in · {output} out",
  yourOwn: "your own model",
  loadMore: "Show more",
  totals: "{count} calls · {amount} used",
  failedCall: "failed",
  // history
  historyTitle: "Purchases and grants",
  historyEmpty: "Nothing yet.",
  purchase: "Purchase",
  refill: "Auto-refill",
  grant: "Grant",
  airdrop: "Drop",
  expiredLot: "Expired",
  adjustment: "Adjustment",
  statusOpen: "waiting for payment",
  statusFailed: "failed",
  statusExpired: "expired",
  refund: "Refund",
  refundMeta: "{money} back to your card",
  refundPending: "pending",
  refundFailed: "failed",
  // refunds
  purchasesTitle: "Your purchases",
  purchasesEmpty: "No purchases yet.",
  unspent: "{tokens} unspent",
  refundable: "{tokens} can be refunded, {money} back to your card.",
  nothingToRefund: "Nothing left to refund.",
  refundedSoFar: "{money} already refunded.",
  refundButton: "Refund…",
  refundConfirm:
    "Refund {tokens} and get {money} back to the card you paid with? The tokens leave your balance now.",
  refundConfirmButton: "Refund {money}",
  refundCancel: "Keep my tokens",
  refunding: "Refunding…",
  refundDone: "Refunded: {money} is on its way back to your card.",
  refundStarted:
    "Refund started: {money} will go back to your card once the payment processor confirms it.",
  refundWait: "A call is still running. Try again in a few seconds.",
  refundLess: "Only {tokens} can be refunded now.",
  refundRefused:
    "The payment processor will not refund this payment to its original method any more. Nothing was taken.",
  // own model
  ownTitle: "Your own model",
  baseUrl: "Address",
  baseUrlHelp:
    "An OpenAI-compatible address that does not include /chat/completions.",
  apiKey: "Key",
  apiKeyHelp: "Stored sealed and never shown again.",
  apiKeySaved: "Saved ({hint}). Leave empty to keep it.",
  removeKey: "Remove the saved key",
  models: "Models",
  modelsHelp: "One per line.",
  defaultModel: "Model to use when the one asked for is not listed",
  capabilities: "What it can do",
  limit: "Most tokens a month",
  limitHelp: "Leave empty for no limit.",
  order: "Which first",
  orders: {
    tokens_then_own: "Tokens first, then my own",
    own_then_tokens: "My own first, then tokens",
    tokens_only: "Tokens only",
    own_only: "My own only",
  },
  toolChoice: "When it is given tools",
  toolChoices: {
    auto: "Let the model decide",
    required: "Require it to call one",
  },
  toolChoiceHelp:
    "Some models only call a tool when told to; choose Require if yours answers in prose instead.",
  orderNeedsOwn: "Save your own model first to use it.",
  test: "Test it",
  testing: "Testing…",
  testOk: "It answered in {ms} ms.",
  testFailed: "It did not answer: {message}",
  remove: "Remove",
  used: "{used} of {limit} used this month.",
  usedNoLimit: "{used} used this month.",
  capability: {
    tools: "Tools",
    streaming: "Streaming",
    vision: "Images",
    json: "JSON",
    voice: "Voice",
  },
} as const

export type Labels = {
  [K in keyof typeof DEFAULT_LABELS]: (typeof DEFAULT_LABELS)[K] extends string
    ? string
    : { [P in keyof (typeof DEFAULT_LABELS)[K]]: string }
}

export type LabelOverrides = {
  [K in keyof Labels]?: Labels[K] extends string ? string : Partial<Labels[K]>
}

/** Replace `{name}` placeholders. */
export const fill = (
  template: string,
  values: Record<string, string | number>,
): string => template.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ""))

export function mergeLabels(...layers: (LabelOverrides | undefined)[]): Labels {
  const out: Record<string, unknown> = { ...DEFAULT_LABELS }
  for (const layer of layers)
    for (const [key, value] of Object.entries(layer ?? {})) {
      if (value === undefined) continue
      const base = out[key]
      out[key] =
        typeof value === "object" && typeof base === "object"
          ? { ...(base as object), ...value }
          : value
    }
  return out as Labels
}
