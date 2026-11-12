/**
 * Buying credits through Stripe: a Checkout Session per purchase, a saved card for automatic
 * refills charged off-session with Stripe Tax, and the webhook's handler that credits what
 * Stripe's own event (fetched back by id, by `@kaperkunde/stripe`'s `handleStripeWebhook`) says
 * was paid -- once, through `{{prefix}}credit`, keyed on the event id.
 *
 * The account may be shared with other products, so everything made here carries the app's
 * `metadata.app` marker and anything without it is ignored.
 */

import type Stripe from "stripe"

import {
  isCurrency,
  moneyText,
  REFILL_FAILURE_TEXT,
  refillFailedMessage,
  type Currencies,
  type RefillFailure,
} from "./billing"
import type { CreditStore } from "./store"
import { DEFAULT_UNIT, creditsText, type CreditUnit } from "./units"

/** "Visa ending 4242", or the method's type in words. */
export const cardLabel = (method: Stripe.PaymentMethod | null | undefined) => {
  if (!method) return undefined
  if (method.card) {
    const brand =
      method.card.brand.charAt(0).toUpperCase() + method.card.brand.slice(1)
    return `${brand} ending ${method.card.last4}`
  }
  return method.type.replace(/_/g, " ")
}

/**
 * What kind of failure a Stripe error or a PaymentIntent's last error is, for the user's words
 * (`REFILL_FAILURE_TEXT`). Anything unrecognised is `error`.
 */
export const refillFailureOf = (error: unknown): RefillFailure => {
  const raw = (error ?? {}) as { decline_code?: string; code?: string }
  const codes = [raw.decline_code, raw.code]
  if (codes.includes("insufficient_funds")) return "insufficient_funds"
  if (codes.includes("expired_card")) return "expired_card"
  if (
    codes.includes("authentication_required") ||
    codes.includes("payment_intent_authentication_failure")
  ) {
    return "authentication_required"
  }
  if (codes.some((code) => code && /declin|card_/.test(code))) return "declined"
  return "error"
}

/** What went wrong with a charge, in Stripe's words: for logs, never for a user. */
export const stripeFailure = (error: unknown) => {
  const raw = error as {
    message?: string
    decline_code?: string
    code?: string
  }
  return (
    raw?.message ??
    raw?.decline_code ??
    raw?.code ??
    "The charge did not go through."
  )
}

/** The numbers the app wrote into an object's metadata, read back; undefined if any is off. */
export const ourNumbers = (metadata: Stripe.Metadata | null | undefined) => {
  const purchaseId = Number(metadata?.purchaseId)
  const credits = Number(metadata?.credits)
  const userId = metadata?.userId
  return Number.isSafeInteger(purchaseId) &&
    Number.isSafeInteger(credits) &&
    userId
    ? { purchaseId, credits, userId }
    : undefined
}

export type PurchasesConfig = {
  store: CreditStore
  /** The Stripe client, or undefined where Stripe is not configured. */
  stripe: () => Stripe | undefined
  /** The `metadata.app` marker everything this app makes carries. */
  app: string
  /** The Product credits are sold as: found by its marker, else made with this id. */
  product: { id: string; name: string; description?: string; taxCode?: string }
  currencies: Currencies
  unit?: CreditUnit
  /** Where Stripe sends the user back to. */
  urls: {
    purchaseDone: string
    purchaseCancelled: string
    cardSaved: string
    cardCancelled: string
  }
  /** A description on the charge, e.g. "2,000,000 credits for Lore Spawner". */
  description?: (credits: number) => string
  /**
   * Told once when a refill fails and auto-refill turns itself off: the message is in the
   * package's words and `failure` says which kind it was. Stripe's own words go to `log`.
   */
  onRefillFailed?: (
    userId: string,
    message: string,
    failure: RefillFailure,
  ) => Promise<void> | void
  /** Where Stripe's own words for a failed refill are written; console.error by default. */
  log?: (message: string, error: unknown) => void
}

export const createPurchases = (config: PurchasesConfig) => {
  const { store, app } = config
  const log =
    config.log ??
    ((message: string, error: unknown) => console.error(message, error))
  Object.keys(config.currencies).forEach((currency) => {
    if (!isCurrency(currency)) {
      throw new Error(
        `Credits are sold in currencies counted in cents (eur, usd, gbp, ...), not ${JSON.stringify(currency)}.`,
      )
    }
  })
  const unit = config.unit ?? DEFAULT_UNIT
  const marker = { app }
  const describe = (credits: number) =>
    config.description?.(credits) ?? creditsText(credits, unit)
  let productId: string | undefined

  const requireStripe = () => {
    const stripe = config.stripe()
    if (!stripe) throw new Error("Stripe is not configured here.")
    return stripe
  }

  const isOurs = (metadata: Stripe.Metadata | null | undefined) =>
    metadata?.app === app

  const taxBehavior = (currency: string) => {
    const behavior = config.currencies[currency]
    if (!behavior) throw new Error(`Credits are not sold in ${currency}.`)
    return behavior
  }

  /** The Product credits are sold as, found by the app's marker or made once. */
  const product = async () => {
    if (productId) return productId
    const stripe = requireStripe()
    const found = await stripe.products.search({
      query: `metadata['app']:'${app}' AND active:'true'`,
      limit: 1,
    })
    let made = found.data[0]
    if (!made) {
      try {
        made = await stripe.products.create({
          id: config.product.id,
          name: config.product.name,
          description: config.product.description,
          tax_code: config.product.taxCode,
          metadata: { ...marker },
        })
      } catch (error) {
        if ((error as { code?: string }).code !== "resource_already_exists")
          throw error
        made = await stripe.products.retrieve(config.product.id)
      }
    }
    productId = made.id
    return made.id
  }

  /** The user's Stripe Customer, made once and kept on their auto-refill row. */
  const ensureCustomer = async (
    user: { id: string; name?: string | null },
    email: string,
  ) => {
    const saved = await store.autorefill(user.id)
    if (saved?.stripeCustomerId) return saved.stripeCustomerId
    const customer = await requireStripe().customers.create({
      email,
      name: user.name ?? undefined,
      metadata: { ...marker, userId: user.id },
    })
    await store.saveCustomer(user.id, customer.id)
    return customer.id
  }

  /**
   * A purchase: opened in the database first, so the credits are fixed by the price in force
   * now, then a Checkout Session for it. Credited only by the webhook.
   */
  const startPurchase = async (
    user: { id: string; name?: string | null },
    email: string,
    currency: string,
    amountCents: number,
    saveCard: boolean,
  ) => {
    const stripe = requireStripe()
    const behavior = taxBehavior(currency)
    const purchase = await store.purchaseOpen(user.id, currency, amountCents)
    const customer = await ensureCustomer(user, email)
    const metadata = {
      ...marker,
      kind: "purchase",
      userId: user.id,
      purchaseId: String(purchase.id),
      credits: String(purchase.credits),
      priceFrom: purchase.priceFrom,
    }
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer,
      customer_update: { address: "auto", name: "auto" },
      billing_address_collection: "auto",
      automatic_tax: { enabled: true },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: amountCents,
            product: await product(),
            tax_behavior: behavior,
          },
        },
      ],
      payment_intent_data: {
        description: describe(purchase.credits),
        metadata,
        ...(saveCard ? { setup_future_usage: "off_session" as const } : {}),
      },
      metadata,
      client_reference_id: String(purchase.id),
      success_url: config.urls.purchaseDone,
      cancel_url: config.urls.purchaseCancelled,
    })
    await store.setPurchaseStripe(purchase.id, { stripeId: session.id })
    if (!session.url)
      throw new Error("Stripe made no checkout page for this purchase.")
    return {
      url: session.url,
      purchaseId: purchase.id,
      credits: purchase.credits,
    }
  }

  /** A Checkout Session that only saves a card, for auto-refill. */
  const startCardSetup = async (
    user: { id: string; name?: string | null },
    email: string,
    currency: string,
  ) => {
    taxBehavior(currency)
    const customer = await ensureCustomer(user, email)
    const metadata = { ...marker, kind: "card", userId: user.id }
    const session = await requireStripe().checkout.sessions.create({
      mode: "setup",
      customer,
      currency,
      billing_address_collection: "required",
      setup_intent_data: { metadata },
      metadata,
      success_url: config.urls.cardSaved,
      cancel_url: config.urls.cardCancelled,
    })
    if (!session.url) throw new Error("Stripe made no page for saving a card.")
    return { url: session.url }
  }

  const customerIdOf = (
    customer:
      string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
  ) => (typeof customer === "string" ? customer : customer?.id)

  const saveCard = async (
    userId: string,
    customer:
      string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
    method: string | Stripe.PaymentMethod | null | undefined,
  ) => {
    const customerId = customerIdOf(customer)
    if (!customerId || !method) return false
    const paymentMethod =
      typeof method === "string"
        ? await requireStripe().paymentMethods.retrieve(method)
        : method
    await store.saveCard(
      userId,
      customerId,
      paymentMethod.id,
      cardLabel(paymentMethod) ?? null,
    )
    return true
  }

  /**
   * A refill that could not be charged: failed, auto-refill off, the user told once. The
   * purchase records the failure in the package's words (a user reads it in their billing
   * history); Stripe's own, `detail`, goes only to the log.
   */
  const failRefill = async (
    purchaseId: number,
    stripeId: string | null,
    failure: RefillFailure,
    detail?: string,
  ) => {
    if (detail)
      log(`Refill ${purchaseId} could not be charged (${failure})`, detail)
    const turnedOff = await store.refillFailed(
      purchaseId,
      stripeId,
      REFILL_FAILURE_TEXT[failure] ?? REFILL_FAILURE_TEXT.error,
    )
    if (turnedOff && config.onRefillFailed) {
      await Promise.resolve(
        config.onRefillFailed(
          turnedOff.userId,
          refillFailedMessage(
            turnedOff.amountCents,
            // It was on, and an enabled refill always has a currency (a CHECK says so).
            turnedOff.currency as string,
            failure,
            unit,
          ),
          failure,
        ),
      ).catch((error) => log("A user could not be told a refill failed", error))
    }
    return Boolean(turnedOff)
  }

  const checkoutCompleted = async (
    event: Stripe.Event,
    session: Stripe.Checkout.Session,
  ) => {
    if (!isOurs(session.metadata)) return "ignored: not this app's"
    const metadata = session.metadata ?? {}
    const stripe = requireStripe()
    if (session.mode === "setup") {
      const intentId =
        typeof session.setup_intent === "string"
          ? session.setup_intent
          : session.setup_intent?.id
      if (!intentId || !metadata.userId) return "ignored: no card"
      const intent = await stripe.setupIntents.retrieve(intentId)
      return (await saveCard(
        metadata.userId,
        session.customer,
        intent.payment_method,
      ))
        ? "card saved"
        : "ignored: no card"
    }
    if (session.mode !== "payment" || session.payment_status !== "paid") {
      return "ignored: not paid"
    }
    const ours = ourNumbers(metadata)
    if (!ours) return "ignored: no purchase named"
    const credited = await store.credit({
      eventId: event.id,
      eventType: event.type,
      ...ours,
      stripeId: session.id,
      taxCents: session.total_details?.amount_tax ?? null,
      totalCents: session.amount_total ?? null,
    })
    const intentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id
    if (intentId) {
      const intent = await stripe.paymentIntents.retrieve(intentId)
      if (intent.setup_future_usage === "off_session") {
        await saveCard(
          ours.userId,
          session.customer ?? intent.customer,
          intent.payment_method,
        )
      }
    }
    return credited ? "credited" : "already credited"
  }

  const refillSucceeded = async (
    event: Stripe.Event,
    intent: Stripe.PaymentIntent,
  ) => {
    if (!isOurs(intent.metadata) || intent.metadata.kind !== "refill") {
      return "ignored: not a refill of this app's"
    }
    const ours = ourNumbers(intent.metadata)
    if (!ours) return "ignored: no purchase named"
    const credited = await store.credit({
      eventId: event.id,
      eventType: event.type,
      ...ours,
      stripeId: intent.id,
      totalCents: intent.amount_received || intent.amount,
    })
    // The tax collected is recorded once the money is in, after the credit, so a failure here
    // is retried by Stripe without holding the credits back; keyed on the PaymentIntent.
    const calculation = intent.metadata.tax_calculation
    if (calculation) {
      try {
        await requireStripe().tax.transactions.createFromCalculation(
          {
            calculation,
            reference: intent.id,
            metadata: { ...marker, purchaseId: String(ours.purchaseId) },
          },
          { idempotencyKey: `${app}-tax-${intent.id}` },
        )
      } catch (error) {
        if (!/reference/i.test((error as Error).message ?? "")) throw error
      }
    }
    return credited ? "credited" : "already credited"
  }

  const refillDeclined = async (intent: Stripe.PaymentIntent) => {
    if (!isOurs(intent.metadata) || intent.metadata.kind !== "refill") {
      return "ignored: not a refill of this app's"
    }
    const ours = ourNumbers(intent.metadata)
    if (!ours) return "ignored: no purchase named"
    await failRefill(
      ours.purchaseId,
      intent.id,
      refillFailureOf(intent.last_payment_error),
      stripeFailure(intent.last_payment_error),
    )
    return "refill failed"
  }

  /**
   * What one event does, once it is known to be real.
   *
   * **Only safe behind `handleStripeWebhook` / `stripeWebhookRoute` (`@kaperkunde/stripe`)**,
   * which checks the signature and then fetches the event back from Stripe by id: this trusts
   * the event's contents -- its purchase id, user and credits -- and credits on them. Never call
   * it with a body read straight off a request.
   *
   * A paid Checkout is credited when it completes, or, for a payment method that settles later
   * (a bank debit), when `checkout.session.async_payment_succeeded` arrives; a refill on
   * `payment_intent.succeeded`, and its failure on `payment_intent.payment_failed`. Anything
   * else, or anything not this app's, is ignored.
   */
  const handleEvent = async (event: Stripe.Event) => {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        return checkoutCompleted(event, event.data.object)
      case "payment_intent.succeeded":
        return refillSucceeded(event, event.data.object)
      case "payment_intent.payment_failed":
        return refillDeclined(event.data.object)
      default:
        return "ignored: not an event this app acts on"
    }
  }

  /** Where a refill's tax is worked out from: the Customer's address, or the card's. */
  const taxLocation = async (
    stripe: Stripe,
    customerId: string,
    paymentMethodId: string,
  ): Promise<
    Pick<Stripe.Tax.CalculationCreateParams, "customer" | "customer_details">
  > => {
    const customer = await stripe.customers.retrieve(customerId)
    if (!customer.deleted && customer.address?.country)
      return { customer: customerId }
    const method = await stripe.paymentMethods.retrieve(paymentMethodId)
    const { address } = method.billing_details
    if (!address?.country) {
      throw new Error(
        "There is no billing address to work the tax out from. Save the card again.",
      )
    }
    return {
      customer_details: {
        address: {
          country: address.country,
          line1: address.line1 ?? undefined,
          line2: address.line2 ?? undefined,
          city: address.city ?? undefined,
          state: address.state ?? undefined,
          postal_code: address.postal_code ?? undefined,
        },
        address_source: "billing",
      },
    }
  }

  /**
   * Charges a refill if one is due: claimed in the database first (one at a time, within the
   * month's maximum), then a tax calculation and an off-session PaymentIntent keyed on it, so
   * a retry is the same charge. Credited by the webhook, never here. Answers what happened.
   */
  const maybeRefill = async (userId: string): Promise<string> => {
    const stripe = config.stripe()
    if (!stripe) return "off: Stripe is not configured"
    const refill = await store.refillClaim(userId)
    if (!refill) return "not due"
    let intentId: string | null = null
    try {
      const settings = await store.autorefill(userId)
      if (!settings?.stripeCustomerId || !settings.paymentMethodId) {
        throw Object.assign(new Error("There is no saved card to charge."), {
          code: "no_card",
        })
      }
      const { currency } = refill
      const calculation = await stripe.tax.calculations.create({
        currency,
        line_items: [
          {
            amount: refill.amountCents,
            reference: `refill-${refill.id}`,
            tax_behavior: taxBehavior(currency),
            tax_code: config.product.taxCode,
            product: await product(),
          },
        ],
        ...(await taxLocation(
          stripe,
          settings.stripeCustomerId,
          settings.paymentMethodId,
        )),
      })
      const total = calculation.amount_total
      const tax =
        calculation.tax_amount_exclusive + calculation.tax_amount_inclusive
      await store.setPurchaseStripe(refill.id, {
        taxCents: tax,
        totalCents: total,
      })
      const intent = await stripe.paymentIntents.create(
        {
          amount: total,
          currency,
          customer: settings.stripeCustomerId,
          payment_method: settings.paymentMethodId,
          off_session: true,
          confirm: true,
          description: `Auto-refill: ${describe(refill.credits)}`,
          metadata: {
            ...marker,
            kind: "refill",
            userId,
            purchaseId: String(refill.id),
            credits: String(refill.credits),
            priceFrom: refill.priceFrom,
            tax_calculation: calculation.id,
          },
        },
        { idempotencyKey: `${app}-refill-${calculation.id}` },
      )
      intentId = intent.id
      await store.setPurchaseStripe(refill.id, { stripeId: intent.id })
      if (intent.status === "succeeded" || intent.status === "processing") {
        return `charged ${intent.id}`
      }
      throw Object.assign(
        new Error(
          intent.last_payment_error?.message ??
            `The charge stopped at ${intent.status}.`,
        ),
        {
          code:
            intent.status === "requires_action"
              ? "authentication_required"
              : (intent.last_payment_error?.decline_code ??
                intent.last_payment_error?.code),
        },
      )
    } catch (error) {
      const declined = (error as { payment_intent?: { id?: string } })
        .payment_intent?.id
      const failure =
        (error as { code?: string }).code === "no_card"
          ? "no_card"
          : refillFailureOf(error)
      await failRefill(
        refill.id,
        intentId ?? declined ?? null,
        failure,
        stripeFailure(error),
      ).catch((failed) => log("A failed refill could not be recorded", failed))
      return `failed: ${failure}`
    }
  }

  return {
    startPurchase,
    startCardSetup,
    ensureCustomer,
    handleEvent,
    maybeRefill,
    failRefill,
    /** "€5.00 buys 2,000,000 credits", for a form. */
    buysText: (amountCents: number, currency: string, credits: number) =>
      `${moneyText(amountCents, currency)} buys ${creditsText(credits, unit)}`,
  }
}

export type Purchases = ReturnType<typeof createPurchases>
