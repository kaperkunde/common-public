-- @kaperkunde/credits: buying credits through Stripe, and topping them up automatically.
--
-- The admin sets what a million credits cost per currency, as a history. A user pays at least
-- {{min_purchase_cents}} cents; the credits it buys are worked out from the price in force when
-- they asked, written on the purchase before Stripe is asked anything, and credited only once
-- Stripe says the money arrived -- once, keyed on Stripe's own event id. Everything that moves
-- a balance is a function here, row-locked, for the server role alone.

-- A currency credits may be sold in: three lower-case letters, counted in hundredths. Every
-- amount here is in cents and goes to Stripe as `unit_amount`, so a zero-decimal currency
-- (jpy: an amount is whole yen) or a three-decimal one (kwd: thousandths) would be charged a
-- hundred times too much or ten times too little. ISK is out too: Stripe takes it only in whole
-- krónur. `isCurrency` in billing.ts is the same rule.
CREATE FUNCTION {{schema}}.{{prefix}}two_decimal_currency(currency text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT currency ~ '^[a-z]{3}$' AND currency NOT IN (
    'bif', 'clp', 'djf', 'gnf', 'isk', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd',
    'vuv', 'xaf', 'xof', 'xpf',
    'bhd', 'jod', 'kwd', 'omr', 'tnd'
  )
$$;

-- What a million credits cost in a currency, from a moment on.
CREATE TABLE {{schema}}.{{table_sale_prices}} (
  currency text NOT NULL
    CONSTRAINT {{prefix}}sale_prices_currency_check CHECK ({{schema}}.{{prefix}}two_decimal_currency(currency)),
  "centsPerMillion" bigint NOT NULL
    CONSTRAINT {{prefix}}sale_prices_cents_check CHECK ("centsPerMillion" > 0),
  "effectiveFrom" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (currency, "effectiveFrom")
);

-- Every Stripe event that has credited anything, by Stripe's id. Inserted first, in the same
-- transaction as the credit, so a replay finds its id taken and grants nothing.
CREATE TABLE {{schema}}.{{table_stripe_events}} (
  id text PRIMARY KEY,
  type text NOT NULL,
  "purchaseId" bigint NULL,
  "receivedAt" timestamptz NOT NULL DEFAULT now()
);

-- One purchase or automatic refill: what was asked for, at which price, and what became of it.
CREATE TABLE {{schema}}.{{table_purchases}} (
  id bigserial PRIMARY KEY,
  "userId" {{owner_id_type}} NOT NULL
    REFERENCES {{schema}}."{{owner_table}}" ("{{owner_id_column}}") ON UPDATE CASCADE ON DELETE CASCADE,
  kind text NOT NULL CONSTRAINT {{prefix}}purchases_kind_check CHECK (kind IN ('purchase', 'refill')),
  -- The Checkout Session (a purchase) or the PaymentIntent (a refill).
  "stripeId" text NULL CONSTRAINT {{prefix}}purchases_stripe_id_key UNIQUE,
  currency text NOT NULL CONSTRAINT {{prefix}}purchases_currency_check CHECK ({{schema}}.{{prefix}}two_decimal_currency(currency)),
  "amountCents" bigint NOT NULL
    CONSTRAINT {{prefix}}purchases_amount_check CHECK ("amountCents" >= {{min_purchase_cents}}),
  "taxCents" bigint NULL,
  "totalCents" bigint NULL,
  credits bigint NOT NULL CONSTRAINT {{prefix}}purchases_credits_check CHECK (credits > 0),
  "priceFrom" timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT {{prefix}}purchases_status_check CHECK (status IN ('pending', 'paid', 'failed', 'abandoned')),
  failure text NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "paidAt" timestamptz NULL
);

CREATE INDEX {{prefix}}purchases_user_created ON {{schema}}.{{table_purchases}} ("userId", "createdAt" DESC);

-- A user's automatic refill: off until they turn it on.
CREATE TABLE {{schema}}.{{table_autorefill}} (
  "userId" {{owner_id_type}} NOT NULL PRIMARY KEY
    REFERENCES {{schema}}."{{owner_table}}" ("{{owner_id_column}}") ON UPDATE CASCADE ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  "thresholdCredits" bigint NOT NULL DEFAULT 100000
    CONSTRAINT {{prefix}}autorefill_threshold_check CHECK ("thresholdCredits" >= 0),
  "amountCents" bigint NOT NULL DEFAULT {{min_purchase_cents}}
    CONSTRAINT {{prefix}}autorefill_amount_check CHECK ("amountCents" >= {{min_purchase_cents}}),
  -- Which currency it charges in: the user's choice, never assumed; set before it is turned on.
  currency text NULL
    CONSTRAINT {{prefix}}autorefill_currency_check CHECK ({{schema}}.{{prefix}}two_decimal_currency(currency)),
  "monthlyMaxCents" bigint NOT NULL DEFAULT 2000,
  "stripeCustomerId" text NULL,
  "paymentMethodId" text NULL,
  -- "Visa ending 4242", so a screen can say which card without Stripe's ids.
  "paymentMethodLabel" text NULL,
  -- A refill claimed and not yet credited or failed: what keeps a burst of calls to one charge.
  pending boolean NOT NULL DEFAULT false,
  "failedAt" timestamptz NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT {{prefix}}autorefill_max_check CHECK ("monthlyMaxCents" >= "amountCents"),
  CONSTRAINT {{prefix}}autorefill_currency_when_enabled CHECK (NOT enabled OR currency IS NOT NULL)
);

CREATE TRIGGER {{prefix}}autorefill_stamp
  BEFORE INSERT OR UPDATE ON {{schema}}.{{table_autorefill}}
  FOR EACH ROW EXECUTE FUNCTION {{schema}}.{{prefix}}stamp();

-- The price of a million credits in a currency at a moment.
CREATE FUNCTION {{schema}}.{{prefix}}sale_price_at(price_currency text, at timestamptz)
RETURNS {{schema}}.{{table_sale_prices}}
LANGUAGE sql
STABLE
AS $$
  SELECT * FROM {{schema}}.{{table_sale_prices}} p
    WHERE p.currency = price_currency AND p."effectiveFrom" <= at
    ORDER BY p."effectiveFrom" DESC
    LIMIT 1
$$;

-- What an amount buys at a price: rounded down. `creditsFor` in billing.ts is the same rule.
CREATE FUNCTION {{schema}}.{{prefix}}credits_for(amount_cents bigint, cents_per_million bigint)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT floor(amount_cents::numeric * 1000000 / cents_per_million)::bigint
$$;

-- A purchase opened, before the user is sent to Stripe: the credits are fixed here, from the
-- price in force now, so what Stripe charges and what the webhook credits are the same thing.
CREATE FUNCTION {{schema}}.{{prefix}}purchase_open(
  user_id {{owner_id_type}}, purchase_currency text, amount_cents bigint
)
RETURNS SETOF {{schema}}.{{table_purchases}}
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  price {{schema}}.{{table_sale_prices}};
BEGIN
  PERFORM {{schema}}.{{prefix}}assert_server('Credits are sold');
  IF amount_cents IS NULL OR amount_cents < {{min_purchase_cents}} THEN
    RAISE EXCEPTION 'A purchase is at least {{min_purchase_cents}} cents.'
      USING ERRCODE = 'check_violation';
  END IF;
  price := {{schema}}.{{prefix}}sale_price_at(purchase_currency, now());
  IF price.currency IS NULL THEN
    RAISE EXCEPTION 'Credits have no price in % yet.', purchase_currency
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
    INSERT INTO {{schema}}.{{table_purchases}}
      ("userId", kind, currency, "amountCents", credits, "priceFrom")
    VALUES (
      user_id, 'purchase', purchase_currency, amount_cents,
      {{schema}}.{{prefix}}credits_for(amount_cents, price."centsPerMillion"), price."effectiveFrom"
    )
    RETURNING *;
END;
$$;

-- Whether a spend has left a user needing a refill, claiming it if so. Due when auto-refill is
-- on with a card, nothing is in flight, the free credits are gone (spent or expired), the bought
-- ones are below the threshold, and one more keeps this calendar month (UTC) within the maximum.
-- `refillDecision` in billing.ts is the same rule. Locked on the settings row; the claim is
-- `pending`. A claim whose charge never reached Stripe within the hour is given up on.
CREATE FUNCTION {{schema}}.{{prefix}}refill_claim(user_id {{owner_id_type}})
RETURNS SETOF {{schema}}.{{table_purchases}}
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  settings {{schema}}.{{table_autorefill}};
  balance {{schema}}.{{table_balances}};
  price {{schema}}.{{table_sale_prices}};
  spent bigint;
BEGIN
  PERFORM {{schema}}.{{prefix}}assert_server('Credits are sold');

  SELECT * INTO settings FROM {{schema}}.{{table_autorefill}} a WHERE a."userId" = user_id FOR UPDATE;
  IF NOT FOUND OR NOT settings.enabled OR settings.currency IS NULL
    OR settings."paymentMethodId" IS NULL OR settings."stripeCustomerId" IS NULL THEN
    RETURN;
  END IF;

  IF settings.pending THEN
    IF EXISTS (
      SELECT 1 FROM {{schema}}.{{table_purchases}} p
      WHERE p."userId" = user_id AND p.kind = 'refill' AND p.status = 'pending'
        AND (p."stripeId" IS NOT NULL OR p."createdAt" > now() - interval '1 hour')
    ) THEN
      RETURN;
    END IF;
    UPDATE {{schema}}.{{table_purchases}} p SET status = 'abandoned'
      WHERE p."userId" = user_id AND p.kind = 'refill' AND p.status = 'pending';
  END IF;

  SELECT * INTO balance FROM {{schema}}.{{table_balances}} b WHERE b."userId" = user_id;
  IF NOT FOUND
    OR (balance.free > 0 AND (balance."freeExpiresAt" IS NULL OR balance."freeExpiresAt" > now()))
    OR balance.purchased >= settings."thresholdCredits" THEN
    RETURN;
  END IF;

  SELECT coalesce(sum(p."amountCents"), 0) INTO spent FROM {{schema}}.{{table_purchases}} p
    WHERE p."userId" = user_id AND p.kind = 'refill' AND p.currency = settings.currency
      -- An abandoned claim counts: its charge may have reached Stripe after all (the process
      -- stopped before writing its id down), so it is held to the maximum as if it had.
      AND p.status IN ('pending', 'paid', 'abandoned')
      AND p."createdAt" >= {{schema}}.{{prefix}}period(now());
  IF spent + settings."amountCents" > settings."monthlyMaxCents" THEN
    RETURN;
  END IF;

  price := {{schema}}.{{prefix}}sale_price_at(settings.currency, now());
  IF price.currency IS NULL THEN
    RETURN;
  END IF;

  UPDATE {{schema}}.{{table_autorefill}} a SET pending = true WHERE a."userId" = user_id;

  RETURN QUERY
    INSERT INTO {{schema}}.{{table_purchases}}
      ("userId", kind, currency, "amountCents", credits, "priceFrom")
    VALUES (
      user_id, 'refill', settings.currency, settings."amountCents",
      {{schema}}.{{prefix}}credits_for(settings."amountCents", price."centsPerMillion"),
      price."effectiveFrom"
    )
    RETURNING *;
END;
$$;

-- Crediting what Stripe says was paid, once. The event id goes in first; a replay answers
-- nothing. The purchase is checked against what the event said (whose, how many credits),
-- marked paid, and its credits added to `purchased`, all in this one transaction. A purchase
-- already paid credits nothing more; a refill's claim is lifted with it.
CREATE FUNCTION {{schema}}.{{prefix}}credit(
  event_id text,
  event_type text,
  purchase_id bigint,
  user_id {{owner_id_type}},
  purchase_credits bigint,
  stripe_id text,
  tax_cents bigint,
  total_cents bigint
)
RETURNS SETOF {{schema}}.{{table_purchases}}
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  purchase {{schema}}.{{table_purchases}};
BEGIN
  PERFORM {{schema}}.{{prefix}}assert_server('Credits are credited');

  INSERT INTO {{schema}}.{{table_stripe_events}} (id, type, "purchaseId")
    VALUES (event_id, event_type, purchase_id)
    ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO purchase FROM {{schema}}.{{table_purchases}} p WHERE p.id = purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stripe event % names purchase %, which does not exist', event_id, purchase_id;
  END IF;
  IF purchase."userId" IS DISTINCT FROM user_id OR purchase.credits IS DISTINCT FROM purchase_credits THEN
    RAISE EXCEPTION 'Stripe event % does not match purchase %', event_id, purchase_id;
  END IF;
  IF purchase.status = 'paid' THEN
    RETURN;
  END IF;

  UPDATE {{schema}}.{{table_purchases}} p
    SET status = 'paid', "paidAt" = now(), failure = NULL,
        "stripeId" = coalesce(stripe_id, p."stripeId"),
        "taxCents" = coalesce(tax_cents, p."taxCents"),
        "totalCents" = coalesce(total_cents, p."totalCents")
    WHERE p.id = purchase_id;

  IF purchase.kind = 'refill' THEN
    UPDATE {{schema}}.{{table_autorefill}} a SET pending = false WHERE a."userId" = purchase."userId";
  END IF;

  INSERT INTO {{schema}}.{{table_balances}} ("userId") VALUES (purchase."userId")
    ON CONFLICT ("userId") DO NOTHING;
  UPDATE {{schema}}.{{table_balances}} b SET purchased = b.purchased + purchase.credits
    WHERE b."userId" = purchase."userId";

  RETURN QUERY SELECT * FROM {{schema}}.{{table_purchases}} p WHERE p.id = purchase_id;
END;
$$;

-- A refill that could not be charged: marked failed, the claim lifted, auto-refill turned off.
-- Answers the settings row only for the call that turned it off, so the user is told once. A
-- purchase already paid is left as it is.
CREATE FUNCTION {{schema}}.{{prefix}}refill_failed(purchase_id bigint, stripe_id text, reason text)
RETURNS SETOF {{schema}}.{{table_autorefill}}
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  purchase {{schema}}.{{table_purchases}};
BEGIN
  PERFORM {{schema}}.{{prefix}}assert_server('Credits are sold');

  SELECT * INTO purchase FROM {{schema}}.{{table_purchases}} p WHERE p.id = purchase_id FOR UPDATE;
  IF NOT FOUND OR purchase.status = 'paid' THEN
    RETURN;
  END IF;

  UPDATE {{schema}}.{{table_purchases}} p
    SET status = 'failed', failure = left(reason, 500),
        "stripeId" = coalesce(stripe_id, p."stripeId")
    WHERE p.id = purchase_id;

  UPDATE {{schema}}.{{table_autorefill}} a SET pending = false WHERE a."userId" = purchase."userId";

  RETURN QUERY
    UPDATE {{schema}}.{{table_autorefill}} a SET enabled = false, "failedAt" = now()
      WHERE a."userId" = purchase."userId" AND a.enabled
      RETURNING a.*;
END;
$$;
