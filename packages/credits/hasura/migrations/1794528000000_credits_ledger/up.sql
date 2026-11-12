-- @kaperkunde/credits: the ledger, prices, balances and the free pool.
--
-- An app spends credits, a unit it names itself. A call (an LLM request, a stretch of
-- text-to-speech, anything metered) is written to the usage ledger as it happens and priced in
-- US dollars from what the admin says each model costs per million units of each kind of usage,
-- then turned into credits by one credits-per-dollar ratio. Prices and the ratio are histories:
-- a call is always priced at what was in force when it was made, so a later change never
-- charges anything twice.
--
-- A user is handed free credits out of the admin's monthly dollar pool when they have nothing
-- left (up to an allotment a month), which expire at the end of that month; what they bought
-- or were granted never expires. Everything that moves a balance is a function here, row-locked,
-- and callable by the server role alone: two calls that each read a balance and wrote it back
-- would each spend the same credits.

-- Who may move a balance: the server role, as Hasura names it on the transaction. Hasura sets
-- `hasura.user` for every request; an app talking to Postgres directly sets it itself
-- (`set_config('hasura.user', '{"x-hasura-role":"<server_role>"}', true)`).
CREATE FUNCTION {{schema}}.{{prefix}}assert_server(what text) RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF (nullif(current_setting('hasura.user', true), '')::json ->> 'x-hasura-role')
      IS DISTINCT FROM '{{server_role}}' THEN
    RAISE EXCEPTION '% by the server alone', what USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

-- The database's clock, never the app's.
CREATE FUNCTION {{schema}}.{{prefix}}stamp() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;

-- The calendar month (UTC) a moment falls in, as its first instant: the pool's period, and the
-- own key's limit's.
CREATE FUNCTION {{schema}}.{{prefix}}period(at timestamptz) RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT date_trunc('month', at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
$$;

-- What the deployment hands out. One row.
CREATE TABLE {{schema}}.{{prefix}}settings (
  id boolean PRIMARY KEY DEFAULT true CONSTRAINT {{prefix}}settings_one_row CHECK (id),
  -- The most free credits one user is handed a month. Zero until the admin decides.
  allotment bigint NOT NULL DEFAULT 0 CONSTRAINT {{prefix}}settings_allotment_check CHECK (allotment >= 0),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO {{schema}}.{{prefix}}settings (id, allotment) VALUES (true, 0);

CREATE TRIGGER {{prefix}}settings_stamp
  BEFORE INSERT OR UPDATE ON {{schema}}.{{prefix}}settings
  FOR EACH ROW EXECUTE FUNCTION {{schema}}.{{prefix}}stamp();

-- One price of one model from a moment on: the version. Its kinds are rows of their own
-- (model_price_kinds), so a model may be priced for any kind of usage -- prompt and answer
-- tokens, cache reads and writes, characters or seconds of speech. A history, never updated:
-- the newest that has begun is the one in force.
CREATE TABLE {{schema}}.{{prefix}}model_prices (
  id bigserial PRIMARY KEY,
  model text NOT NULL,
  "effectiveFrom" timestamptz NOT NULL DEFAULT now(),
  -- A request whose whole prompt (fresh, cached and written) is past this many units costs
  -- `longPromptFactor` times as much in every kind; null for a model with no such tier.
  "longPromptUnits" bigint NULL
    CONSTRAINT {{prefix}}model_prices_long_units_check CHECK ("longPromptUnits" > 0),
  "longPromptFactor" numeric NULL
    CONSTRAINT {{prefix}}model_prices_long_factor_check CHECK ("longPromptFactor" > 0),
  -- Where it came from: `admin`, or a price source's own name.
  source text NOT NULL DEFAULT 'admin'
    CONSTRAINT {{prefix}}model_prices_source_check CHECK (length(source) BETWEEN 1 AND 80),
  -- When a source last confirmed it; null for a price entered by hand.
  "syncedAt" timestamptz NULL,
  CONSTRAINT {{prefix}}model_prices_model_from_key UNIQUE (model, "effectiveFrom")
);

-- What one kind of usage costs under a price: US dollars per million units. A kind the admin
-- left out but a fallback could work out is written here too, `derived`, when the price is set:
-- a price version is whole and never changes, so a call is charged what it said on the day
-- whatever happens to the fallbacks later.
CREATE TABLE {{schema}}.{{prefix}}model_price_kinds (
  "priceId" bigint NOT NULL
    REFERENCES {{schema}}.{{prefix}}model_prices (id) ON DELETE CASCADE,
  kind text NOT NULL
    CONSTRAINT {{prefix}}model_price_kinds_kind_check CHECK (kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  -- What one unit is, in words: `token`, `char`, `second`. For the screens.
  unit text NOT NULL DEFAULT 'token'
    CONSTRAINT {{prefix}}model_price_kinds_unit_check CHECK (length(unit) BETWEEN 1 AND 40),
  "usdPerMillion" numeric NOT NULL
    CONSTRAINT {{prefix}}model_price_kinds_usd_check CHECK ("usdPerMillion" >= 0),
  -- Worked out from a fallback when the price was set, rather than set by whoever set it.
  derived boolean NOT NULL DEFAULT false,
  PRIMARY KEY ("priceId", kind)
);

-- A kind a price leaves out, worked out from another: a cache read a tenth of a fresh prompt
-- token, and so on. Read only when a price is set, which writes the kinds it works out onto
-- that version (`derived`); a change here is a default for prices set from then on, and never
-- reprices a call already made. Data, so an app may change or remove the defaults; a kind a
-- version neither sets nor derived is unpriced, and a call that used it cannot be charged.
CREATE TABLE {{schema}}.{{prefix}}kind_fallbacks (
  kind text PRIMARY KEY,
  "baseKind" text NOT NULL,
  multiple numeric NOT NULL CONSTRAINT {{prefix}}kind_fallbacks_multiple_check CHECK (multiple >= 0),
  CONSTRAINT {{prefix}}kind_fallbacks_not_self CHECK (kind <> "baseKind")
);

INSERT INTO {{schema}}.{{prefix}}kind_fallbacks (kind, "baseKind", multiple) VALUES
  ('cache_read', 'input', 0.1),
  ('cache_write', 'input', 1.25),
  ('cache_write_1h', 'input', 2);

-- Multiples a request is priced at for one value of one of its dimensions -- where it ran, a
-- batch, fast mode. `model` null holds for every model; a model's own row wins over that. Any
-- value with no row is 1x. A history like the prices.
CREATE TABLE {{schema}}.{{prefix}}price_factors (
  id bigserial PRIMARY KEY,
  model text NULL,
  dimension text NOT NULL
    CONSTRAINT {{prefix}}price_factors_dimension_check CHECK (dimension ~ '^[a-z][a-z0-9_]{0,39}$'),
  value text NOT NULL,
  factor numeric NOT NULL CONSTRAINT {{prefix}}price_factors_factor_check CHECK (factor > 0),
  "effectiveFrom" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX {{prefix}}price_factors_key
  ON {{schema}}.{{prefix}}price_factors (coalesce(model, ''), dimension, value, "effectiveFrom");

-- How many credits a dollar of a provider's price comes to, from a moment on.
CREATE TABLE {{schema}}.{{prefix}}dollar_rates (
  "perDollar" numeric NOT NULL CONSTRAINT {{prefix}}dollar_rates_positive CHECK ("perDollar" > 0),
  "effectiveFrom" timestamptz NOT NULL DEFAULT now() PRIMARY KEY
);

-- One row per metered call, written by the server and changed afterwards only by spend.
CREATE TABLE {{schema}}.{{usage_table}} (
  id bigserial PRIMARY KEY,
  -- Whose balance this came out of.
  "userId" {{owner_id_type}} NOT NULL
    REFERENCES {{schema}}."{{owner_table}}" ("{{owner_id_column}}") ON UPDATE CASCADE ON DELETE CASCADE,
  -- What it was spent on, if anything (a world, a project, a room), as the app names it.
  "scopeId" text NULL,
  -- The job it ran for, if any.
  "jobId" text NULL,
  -- Which piece of work asked; free text, an app adds its own CHECK.
  purpose text NOT NULL,
  -- What sort of call: `llm`, `tts`, ...; free text too.
  kind text NOT NULL DEFAULT 'llm',
  model text NOT NULL,
  -- What the call was for, in words, for an activity list.
  activity text NULL,
  -- The call's tokens as the provider reported them. Cached and written are part of input;
  -- the hour-long writes part of the writes.
  "inputTokens" bigint NOT NULL DEFAULT 0,
  "outputTokens" bigint NOT NULL DEFAULT 0,
  "totalTokens" bigint NOT NULL DEFAULT 0,
  "cachedTokens" bigint NOT NULL DEFAULT 0,
  "cacheWriteTokens" bigint NOT NULL DEFAULT 0,
  "cacheWrite1hTokens" bigint NOT NULL DEFAULT 0,
  "reasoningTokens" bigint NOT NULL DEFAULT 0,
  -- Usage that is not prompt-and-answer tokens, by price kind: {"tts_chars": 1200}.
  units jsonb NULL,
  -- Each request of a call that took several, as the provider billed it; null is one request
  -- read off the columns above.
  requests jsonb NULL,
  -- Where, how fast and at what tier the call ran, for a call priced as one request.
  "inferenceGeo" text NULL,
  speed text NULL,
  "serviceTier" text NULL,
  -- Who paid: `own` is the user's own key, written so as it lands; the rest is spend's.
  source text NULL
    CONSTRAINT {{usage_table}}_source_check CHECK (source IN ('free', 'purchased', 'own')),
  credits bigint NULL,
  -- The price and the ratio it was converted at.
  "priceFrom" timestamptz NULL,
  "ratioFrom" timestamptz NULL,
  -- Its dollars, and how its credits split.
  usd numeric NULL,
  "freeCredits" bigint NULL,
  "purchasedCredits" bigint NULL,
  "overdraftCredits" bigint NULL,
  "freeUsd" numeric NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT {{usage_table}}_own_costs_nothing_check
    CHECK (source IS DISTINCT FROM 'own' OR credits = 0)
);

CREATE INDEX {{usage_table}}_user_created_idx ON {{schema}}.{{usage_table}} ("userId", "createdAt");
CREATE INDEX {{usage_table}}_pending_idx ON {{schema}}.{{usage_table}} (id) WHERE credits IS NULL;
CREATE INDEX {{usage_table}}_user_source_idx
  ON {{schema}}.{{usage_table}} ("userId", source, "createdAt");

-- One user's credits. Absent until they first ask for anything.
CREATE TABLE {{schema}}.{{prefix}}balances (
  "userId" {{owner_id_type}} NOT NULL PRIMARY KEY
    REFERENCES {{schema}}."{{owner_table}}" ("{{owner_id_column}}") ON UPDATE CASCADE ON DELETE CASCADE,
  -- What is left of the free credits; below zero only by an overdraft, forgiven at expiry.
  free bigint NOT NULL DEFAULT 0,
  -- Bought or granted, never expiring, never below zero.
  purchased bigint NOT NULL DEFAULT 0 CONSTRAINT {{prefix}}balances_purchased_check CHECK (purchased >= 0),
  -- When the free credits held expire: the end of the month that granted them.
  "freeExpiresAt" timestamptz NULL,
  -- The month a user was last told they had run out, so they are told once a month.
  "notifiedFor" timestamptz NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER {{prefix}}balances_stamp
  BEFORE INSERT OR UPDATE ON {{schema}}.{{prefix}}balances
  FOR EACH ROW EXECUTE FUNCTION {{schema}}.{{prefix}}stamp();

-- What the admin will spend on free credits a month, in US dollars, from a moment on. No row
-- at all is a budget of nothing.
CREATE TABLE {{schema}}.{{prefix}}pool_budgets (
  "effectiveFrom" timestamptz NOT NULL DEFAULT now() PRIMARY KEY,
  "budgetUsd" numeric NOT NULL CONSTRAINT {{prefix}}pool_budgets_budget_check CHECK ("budgetUsd" >= 0),
  "adminEmail" text NOT NULL
);

-- One month of the pool: what has come out of it. The row a grant locks.
CREATE TABLE {{schema}}.{{prefix}}pool_periods (
  "periodStart" timestamptz NOT NULL PRIMARY KEY,
  "grantedCredits" bigint NOT NULL DEFAULT 0,
  "grantedUsd" numeric NOT NULL DEFAULT 0,
  -- Dollars spent past a user's free and bought credits: real spend nobody granted.
  "overdraftUsd" numeric NOT NULL DEFAULT 0,
  -- The provider's own figure for the month and the ledger's, in US cents, where a cost check
  -- has them.
  "providerCents" numeric NULL,
  "ledgerCents" numeric NULL,
  -- The provider's figure over the ledger's, never below one: every dollar granted counts for
  -- this many against the budget.
  "driftFactor" numeric NOT NULL DEFAULT 1
    CONSTRAINT {{prefix}}pool_periods_drift_check CHECK ("driftFactor" >= 1),
  "checkedAt" timestamptz NULL,
  -- When the admin was told the pool was low, empty, or the bill over budget; claimed first.
  "notifiedLowAt" timestamptz NULL,
  "notifiedEmptyAt" timestamptz NULL,
  "notifiedOverAt" timestamptz NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER {{prefix}}pool_periods_stamp
  BEFORE INSERT OR UPDATE ON {{schema}}.{{prefix}}pool_periods
  FOR EACH ROW EXECUTE FUNCTION {{schema}}.{{prefix}}stamp();

-- Every handout of free credits: what the pool paid, to whom, in which month.
CREATE TABLE {{schema}}.{{prefix}}free_grants (
  id bigserial PRIMARY KEY,
  "userId" {{owner_id_type}} NOT NULL
    REFERENCES {{schema}}."{{owner_table}}" ("{{owner_id_column}}") ON UPDATE CASCADE ON DELETE CASCADE,
  "periodStart" timestamptz NOT NULL,
  credits bigint NOT NULL CONSTRAINT {{prefix}}free_grants_credits_check CHECK (credits > 0),
  usd numeric NOT NULL CONSTRAINT {{prefix}}free_grants_usd_check CHECK (usd >= 0),
  "ratioFrom" timestamptz NULL,
  -- `refill` from the pool; `carried` for a balance an app brought with it.
  kind text NOT NULL DEFAULT 'refill'
    CONSTRAINT {{prefix}}free_grants_kind_check CHECK (kind IN ('refill', 'carried')),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX {{prefix}}free_grants_user_period ON {{schema}}.{{prefix}}free_grants ("userId", "periodStart");
CREATE INDEX {{prefix}}free_grants_period ON {{schema}}.{{prefix}}free_grants ("periodStart");

-- The admin granting credits, or taking some back: who, how many, why, and which admin.
CREATE TABLE {{schema}}.{{prefix}}grants (
  id bigserial PRIMARY KEY,
  "userId" {{owner_id_type}} NOT NULL
    REFERENCES {{schema}}."{{owner_table}}" ("{{owner_id_column}}") ON UPDATE CASCADE ON DELETE CASCADE,
  amount bigint NOT NULL CONSTRAINT {{prefix}}grants_amount_check CHECK (amount <> 0),
  reason text NOT NULL CONSTRAINT {{prefix}}grants_reason_check CHECK (length(trim(reason)) > 0),
  -- The deployment's own record, never the user's to read.
  "adminEmail" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX {{prefix}}grants_user_created ON {{schema}}.{{prefix}}grants ("userId", "createdAt" DESC);
CREATE INDEX {{prefix}}grants_created ON {{schema}}.{{prefix}}grants ("createdAt" DESC);

-- A user's own model: an endpoint and a key of their own, which their calls may run on instead
-- of -- or as well as -- the deployment's and its credits. The key is sealed by the app before
-- it is written (`@kaperkunde/security`'s secret box) and never selectable by any role a user
-- or an agent reaches. What it costs is the provider's tokens, never credits; the one limit is
-- the user's, per calendar month.
CREATE TABLE {{schema}}.{{prefix}}own_backends (
  "userId" {{owner_id_type}} NOT NULL PRIMARY KEY
    REFERENCES {{schema}}."{{owner_table}}" ("{{owner_id_column}}") ON UPDATE CASCADE ON DELETE CASCADE,
  "baseUrl" text NOT NULL
    CONSTRAINT {{prefix}}own_backends_base_url_check CHECK ("baseUrl" ~ '^https?://'),
  "keyCiphertext" text NULL
    CONSTRAINT {{prefix}}own_backends_key_sealed_check CHECK ("keyCiphertext" ~ '^v[0-9]+:'),
  "keyLast4" text NULL
    CONSTRAINT {{prefix}}own_backends_key_last4_check CHECK (char_length("keyLast4") <= 4),
  -- The models it may run, comma-separated in the order given.
  models text NOT NULL DEFAULT '',
  "toolChoice" text NOT NULL DEFAULT 'required'
    CONSTRAINT {{prefix}}own_backends_tool_choice_check CHECK ("toolChoice" IN ('required', 'auto')),
  -- The provider's tokens it may spend a calendar month (UTC); null is no limit.
  "tokenLimit" bigint NULL
    CONSTRAINT {{prefix}}own_backends_limit_check CHECK ("tokenLimit" >= 0),
  "order" text NOT NULL DEFAULT 'own_then_credits'
    CONSTRAINT {{prefix}}own_backends_order_check
    CHECK ("order" IN ('credits_then_own', 'own_then_credits', 'credits_only', 'own_only')),
  -- The month the user was last told their key reached its limit.
  "limitNotifiedFor" timestamptz NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER {{prefix}}own_backends_stamp
  BEFORE INSERT OR UPDATE ON {{schema}}.{{prefix}}own_backends
  FOR EACH ROW EXECUTE FUNCTION {{schema}}.{{prefix}}stamp();

-- A price set whole, in one statement: the version and its kinds. `kinds` is
-- [{"kind": "input", "unit": "token", "usdPerMillion": 3}, ...]; an entry marked
-- `"derived": true` (a price read back and set again) is left out and worked out afresh. Every
-- kind a fallback can work out from what was given is written onto the version too, marked
-- derived, so the version alone says what each kind cost. Server only.
CREATE FUNCTION {{schema}}.{{prefix}}set_model_price(
  price_model text,
  kinds jsonb,
  long_prompt_units bigint DEFAULT NULL,
  long_prompt_factor numeric DEFAULT NULL,
  price_source text DEFAULT 'admin',
  synced_at timestamptz DEFAULT NULL,
  effective_from timestamptz DEFAULT now()
)
RETURNS SETOF {{schema}}.{{prefix}}model_prices
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  price {{schema}}.{{prefix}}model_prices;
  entry jsonb;
BEGIN
  PERFORM {{schema}}.{{prefix}}assert_server('Prices are set');
  IF price_model IS NULL OR length(trim(price_model)) = 0 THEN
    RAISE EXCEPTION 'A price names its model.' USING ERRCODE = 'check_violation';
  END IF;
  IF kinds IS NULL OR jsonb_typeof(kinds) <> 'array' OR jsonb_array_length(kinds) = 0 THEN
    RAISE EXCEPTION 'A price of % says what at least one kind of usage costs.', price_model
      USING ERRCODE = 'check_violation';
  END IF;

  -- A prompt-and-answer price says both halves: one with input and no output (or the reverse)
  -- would let a call through admit and then leave it unpriced on the ledger.
  IF (kinds @> '[{"kind": "input"}]') <> (kinds @> '[{"kind": "output"}]') THEN
    RAISE EXCEPTION 'A price of % sets input and output together, or neither.', price_model
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO {{schema}}.{{prefix}}model_prices
    (model, "effectiveFrom", "longPromptUnits", "longPromptFactor", source, "syncedAt")
  VALUES (
    trim(price_model), coalesce(effective_from, now()), long_prompt_units, long_prompt_factor,
    coalesce(price_source, 'admin'), synced_at
  )
  RETURNING * INTO price;

  FOR entry IN SELECT value FROM jsonb_array_elements(kinds)
      WHERE coalesce((value ->> 'derived')::boolean, false) IS NOT TRUE LOOP
    INSERT INTO {{schema}}.{{prefix}}model_price_kinds ("priceId", kind, unit, "usdPerMillion")
    VALUES (
      price.id, entry ->> 'kind', coalesce(entry ->> 'unit', 'token'),
      (entry ->> 'usdPerMillion')::numeric
    );
  END LOOP;

  INSERT INTO {{schema}}.{{prefix}}model_price_kinds
    ("priceId", kind, unit, "usdPerMillion", derived)
  SELECT price.id, f.kind, b.unit, b."usdPerMillion" * f.multiple, true
    FROM {{schema}}.{{prefix}}kind_fallbacks f
    JOIN {{schema}}.{{prefix}}model_price_kinds b
      ON b."priceId" = price.id AND b.kind = f."baseKind" AND NOT b.derived
    WHERE NOT EXISTS (
      SELECT 1 FROM {{schema}}.{{prefix}}model_price_kinds k
        WHERE k."priceId" = price.id AND k.kind = f.kind
    );

  RETURN NEXT price;
END;
$$;

-- The price of a model in force at a moment: the newest version that had begun.
CREATE FUNCTION {{schema}}.{{prefix}}price_at(price_model text, at timestamptz)
RETURNS {{schema}}.{{prefix}}model_prices
LANGUAGE sql
STABLE
AS $$
  SELECT * FROM {{schema}}.{{prefix}}model_prices p
    WHERE p.model = price_model AND p."effectiveFrom" <= at
    ORDER BY p."effectiveFrom" DESC
    LIMIT 1
$$;

-- The kinds of `needed` the price of a model in force at a moment cannot charge: every one of
-- them where the model has no price at all, none where the call can be priced. What admit and
-- would_admit ask before a call, so a call is never let through to land unpriced on the ledger.
CREATE FUNCTION {{schema}}.{{prefix}}missing_kinds(
  price_model text, needed text[], at timestamptz DEFAULT now()
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  price {{schema}}.{{prefix}}model_prices;
BEGIN
  price := {{schema}}.{{prefix}}price_at(price_model, at);
  IF price.id IS NULL THEN
    RETURN coalesce(needed, ARRAY[]::text[]);
  END IF;
  RETURN coalesce(
    (SELECT array_agg(n ORDER BY n) FROM unnest(needed) n
      WHERE {{schema}}.{{prefix}}kind_usd(price.id, n) IS NULL),
    ARRAY[]::text[]
  );
END;
$$;

-- What one kind costs under a price, in dollars per million units: the version's own row,
-- set or derived when it was set; null where it has none. Never the fallbacks as they are now.
CREATE FUNCTION {{schema}}.{{prefix}}kind_usd(price_id bigint, price_kind text)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT k."usdPerMillion" FROM {{schema}}.{{prefix}}model_price_kinds k
    WHERE k."priceId" = price_id AND k.kind = price_kind
$$;

-- A factor in force at a moment: the model's own, else every model's, else 1.
CREATE FUNCTION {{schema}}.{{prefix}}factor_at(
  price_model text, factor_dimension text, factor_value text, at timestamptz
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    (SELECT f.factor FROM {{schema}}.{{prefix}}price_factors f
      WHERE f.model = price_model AND f.dimension = factor_dimension
        AND f.value = factor_value AND f."effectiveFrom" <= at
      ORDER BY f."effectiveFrom" DESC LIMIT 1),
    (SELECT f.factor FROM {{schema}}.{{prefix}}price_factors f
      WHERE f.model IS NULL AND f.dimension = factor_dimension
        AND f.value = factor_value AND f."effectiveFrom" <= at
      ORDER BY f."effectiveFrom" DESC LIMIT 1),
    1
  )
$$;

-- One kind's dollars for a quantity, refusing a kind nobody priced.
CREATE FUNCTION {{schema}}.{{prefix}}kind_cost(
  price {{schema}}.{{prefix}}model_prices, price_kind text, quantity numeric
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  usd numeric;
BEGIN
  IF quantity IS NULL OR quantity <= 0 THEN
    RETURN 0;
  END IF;
  usd := {{schema}}.{{prefix}}kind_usd(price.id, price_kind);
  IF usd IS NULL THEN
    RAISE EXCEPTION 'The model % has no price for %', price.model, price_kind
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN quantity * usd;
END;
$$;

-- What one call cost in US dollars at a price, request by request, plus whatever it used that
-- is not prompt and answer (`units`). Every count is held inside the one above it whatever a
-- provider reports. `callUsd` in pricing.ts is the same arithmetic.
CREATE FUNCTION {{schema}}.{{prefix}}call_usd(
  usage {{schema}}.{{usage_table}}, price {{schema}}.{{prefix}}model_prices
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  requests jsonb := usage.requests;
  req jsonb;
  dims jsonb;
  dim record;
  unit record;
  prompt numeric;
  cached numeric;
  written numeric;
  kept_long numeric;
  answer numeric;
  factor numeric;
  total numeric := 0;
BEGIN
  IF requests IS NULL OR jsonb_typeof(requests) <> 'array' OR jsonb_array_length(requests) = 0 THEN
    IF usage."inputTokens" + usage."outputTokens" > 0 THEN
      requests := jsonb_build_array(jsonb_build_object(
        'inputTokens', usage."inputTokens", 'cachedTokens', usage."cachedTokens",
        'cacheWriteTokens', usage."cacheWriteTokens",
        'cacheWrite1hTokens', usage."cacheWrite1hTokens", 'outputTokens', usage."outputTokens",
        'inferenceGeo', usage."inferenceGeo", 'speed', usage.speed,
        'serviceTier', usage."serviceTier"
      ));
    ELSE
      requests := '[]'::jsonb;
    END IF;
  END IF;

  FOR req IN SELECT value FROM jsonb_array_elements(requests) LOOP
    prompt := greatest(coalesce((req ->> 'inputTokens')::numeric, 0), 0);
    cached := least(greatest(coalesce((req ->> 'cachedTokens')::numeric, 0), 0), prompt);
    written := least(greatest(coalesce((req ->> 'cacheWriteTokens')::numeric, 0), 0), prompt - cached);
    kept_long := least(greatest(coalesce((req ->> 'cacheWrite1hTokens')::numeric, 0), 0), written);
    answer := greatest(coalesce((req ->> 'outputTokens')::numeric, 0), 0);

    factor := 1;
    IF price."longPromptUnits" IS NOT NULL AND prompt > price."longPromptUnits" THEN
      factor := factor * coalesce(price."longPromptFactor", 1);
    END IF;
    -- The request's dimensions: its own map, and the three a provider usually reports.
    dims := jsonb_strip_nulls(jsonb_build_object(
      'inference_geo', req ->> 'inferenceGeo',
      'speed', req ->> 'speed',
      'service_tier', req ->> 'serviceTier'
    ));
    IF jsonb_typeof(req -> 'dimensions') = 'object' THEN
      dims := dims || (req -> 'dimensions');
    END IF;
    FOR dim IN SELECT key, value FROM jsonb_each_text(dims) LOOP
      IF dim.value IS NOT NULL THEN
        factor := factor * {{schema}}.{{prefix}}factor_at(price.model, dim.key, dim.value, usage."createdAt");
      END IF;
    END LOOP;

    total := total + factor * (
      {{schema}}.{{prefix}}kind_cost(price, 'input', prompt - cached - written)
      + {{schema}}.{{prefix}}kind_cost(price, 'cache_read', cached)
      + {{schema}}.{{prefix}}kind_cost(price, 'cache_write', written - kept_long)
      + {{schema}}.{{prefix}}kind_cost(price, 'cache_write_1h', kept_long)
      + {{schema}}.{{prefix}}kind_cost(price, 'output', answer)
    );
  END LOOP;

  IF usage.units IS NOT NULL AND jsonb_typeof(usage.units) = 'object' THEN
    FOR unit IN SELECT key, value FROM jsonb_each_text(usage.units) LOOP
      total := total + {{schema}}.{{prefix}}kind_cost(
        price, unit.key, greatest(coalesce(unit.value::numeric, 0), 0)
      );
    END LOOP;
  END IF;

  RETURN total / 1000000;
END;
$$;

-- What the pool could still hand one user in a month now: what is left of their allotment, or
-- what is left of the pool at the ratio in force, whichever is less. Reads the pool as given,
-- so admit can pass it the row it has locked.
CREATE FUNCTION {{schema}}.{{prefix}}pool_could_give(
  user_id {{owner_id_type}}, period timestamptz, granted numeric, overdraft numeric, drift numeric
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  allotment bigint;
  taken bigint;
  per_dollar numeric;
  budget numeric;
  left_usd numeric;
BEGIN
  SELECT s.allotment INTO allotment FROM {{schema}}.{{prefix}}settings s WHERE s.id;
  SELECT coalesce(sum(g.credits), 0) INTO taken FROM {{schema}}.{{prefix}}free_grants g
    WHERE g."userId" = user_id AND g."periodStart" = period;
  IF coalesce(allotment, 0) - taken <= 0 THEN
    RETURN 0;
  END IF;
  SELECT r."perDollar" INTO per_dollar FROM {{schema}}.{{prefix}}dollar_rates r
    WHERE r."effectiveFrom" <= now() ORDER BY r."effectiveFrom" DESC LIMIT 1;
  IF per_dollar IS NULL THEN
    RETURN 0;
  END IF;
  SELECT b."budgetUsd" INTO budget FROM {{schema}}.{{prefix}}pool_budgets b
    WHERE b."effectiveFrom" <= now() ORDER BY b."effectiveFrom" DESC LIMIT 1;
  left_usd := coalesce(budget, 0) - (granted + overdraft) * drift;
  IF left_usd <= 0 THEN
    RETURN 0;
  END IF;
  RETURN least(coalesce(allotment, 0) - taken, floor(left_usd * per_dollar / drift))::bigint;
END;
$$;

-- Whether a user may start a call, handing them free credits from the pool on the way if they
-- have nothing left. Free credits past their month are gone (an overdraft with them). A user
-- with nothing left, free or bought, is handed what the pool can give them, set outright,
-- expiring at the month's end, its dollars taken from the pool in the same breath. Answers the
-- balance; anything above zero is admitted.
--
-- Given a model and the kinds the call will use (`input` and `output` for a prompt-and-answer
-- call, the unit kind for a metered one), a call the price in force cannot charge is refused
-- first, before anything is handed out: it would otherwise run, land on the ledger unpriced,
-- and leave the balance as it was.
--
-- Locks the balance, then the month's pool: the order spend takes them in.
CREATE FUNCTION {{schema}}.{{prefix}}admit(
  user_id {{owner_id_type}}, price_model text DEFAULT NULL, needed text[] DEFAULT NULL
)
RETURNS SETOF {{schema}}.{{prefix}}balances
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  balance {{schema}}.{{prefix}}balances;
  pool {{schema}}.{{prefix}}pool_periods;
  ratio {{schema}}.{{prefix}}dollar_rates;
  period timestamptz := {{schema}}.{{prefix}}period(now());
  given bigint;
  missing text[];
BEGIN
  PERFORM {{schema}}.{{prefix}}assert_server('Credits are handed out');
  IF price_model IS NOT NULL THEN
    missing := {{schema}}.{{prefix}}missing_kinds(price_model, coalesce(needed, ARRAY['input', 'output']));
    IF cardinality(missing) > 0 THEN
      RAISE EXCEPTION 'The model % has no price for %.', price_model, array_to_string(missing, ', ')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO {{schema}}.{{prefix}}balances ("userId") VALUES (user_id)
    ON CONFLICT ("userId") DO NOTHING;
  SELECT * INTO balance FROM {{schema}}.{{prefix}}balances b WHERE b."userId" = user_id FOR UPDATE;

  IF balance."freeExpiresAt" IS NOT NULL AND balance."freeExpiresAt" <= now() THEN
    UPDATE {{schema}}.{{prefix}}balances b SET free = 0, "freeExpiresAt" = NULL
      WHERE b."userId" = user_id
      RETURNING * INTO balance;
  END IF;

  IF balance.free + balance.purchased <= 0 THEN
    INSERT INTO {{schema}}.{{prefix}}pool_periods ("periodStart") VALUES (period)
      ON CONFLICT ("periodStart") DO NOTHING;
    SELECT * INTO pool FROM {{schema}}.{{prefix}}pool_periods p
      WHERE p."periodStart" = period FOR UPDATE;
    given := {{schema}}.{{prefix}}pool_could_give(
      user_id, period, pool."grantedUsd", pool."overdraftUsd", pool."driftFactor"
    );
    IF given > 0 THEN
      SELECT * INTO ratio FROM {{schema}}.{{prefix}}dollar_rates r
        WHERE r."effectiveFrom" <= now() ORDER BY r."effectiveFrom" DESC LIMIT 1;
      INSERT INTO {{schema}}.{{prefix}}free_grants ("userId", "periodStart", credits, usd, "ratioFrom")
        VALUES (user_id, period, given, given / ratio."perDollar", ratio."effectiveFrom");
      UPDATE {{schema}}.{{prefix}}pool_periods p
        SET "grantedCredits" = p."grantedCredits" + given,
            "grantedUsd" = p."grantedUsd" + given / ratio."perDollar"
        WHERE p."periodStart" = period;
      UPDATE {{schema}}.{{prefix}}balances b
        SET free = given, "freeExpiresAt" = period + interval '1 month'
        WHERE b."userId" = user_id;
    END IF;
  END IF;

  RETURN QUERY SELECT * FROM {{schema}}.{{prefix}}balances b WHERE b."userId" = user_id;
END;
$$;

-- Whether admit would admit a user now, changing nothing: what a paused job asks before it
-- tries again. Given a model (and the kinds, as admit takes them), false where the price in
-- force cannot charge the call.
CREATE FUNCTION {{schema}}.{{prefix}}would_admit(
  user_id {{owner_id_type}}, price_model text DEFAULT NULL, needed text[] DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  balance {{schema}}.{{prefix}}balances;
  pool {{schema}}.{{prefix}}pool_periods;
  period timestamptz := {{schema}}.{{prefix}}period(now());
  free_now bigint := 0;
  bought bigint := 0;
BEGIN
  IF price_model IS NOT NULL AND cardinality({{schema}}.{{prefix}}missing_kinds(
    price_model, coalesce(needed, ARRAY['input', 'output'])
  )) > 0 THEN
    RETURN false;
  END IF;
  SELECT * INTO balance FROM {{schema}}.{{prefix}}balances b WHERE b."userId" = user_id;
  IF FOUND THEN
    bought := balance.purchased;
    IF balance."freeExpiresAt" IS NULL OR balance."freeExpiresAt" > now() THEN
      free_now := balance.free;
    END IF;
  END IF;
  IF free_now + bought > 0 THEN
    RETURN true;
  END IF;
  SELECT * INTO pool FROM {{schema}}.{{prefix}}pool_periods p WHERE p."periodStart" = period;
  RETURN {{schema}}.{{prefix}}pool_could_give(
    user_id, period,
    coalesce(pool."grantedUsd", 0), coalesce(pool."overdraftUsd", 0),
    coalesce(pool."driftFactor", 1)
  ) > 0;
END;
$$;

-- What one call cost, in credits, taken from the user who made it: its dollars at the price in
-- force when it was made, times the ratio in force then, rounded up. Free first, then bought;
-- only when both are gone does free go below zero, and an overdraft's dollars come out of the
-- month's pool. Idempotent on the row: one already converted (or written as the user's own
-- key's) is returned as it stands.
CREATE FUNCTION {{schema}}.{{prefix}}spend(usage_id bigint)
RETURNS SETOF {{schema}}.{{usage_table}}
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  usage {{schema}}.{{usage_table}};
  price {{schema}}.{{prefix}}model_prices;
  ratio {{schema}}.{{prefix}}dollar_rates;
  balance {{schema}}.{{prefix}}balances;
  period timestamptz := {{schema}}.{{prefix}}period(now());
  dollars numeric;
  cost bigint;
  from_free bigint;
  from_purchased bigint;
  short bigint;
BEGIN
  PERFORM {{schema}}.{{prefix}}assert_server('Credits are spent');

  SELECT * INTO usage FROM {{schema}}.{{usage_table}} u WHERE u.id = usage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No call % on the ledger', usage_id;
  END IF;
  IF usage.credits IS NOT NULL THEN
    RETURN QUERY SELECT * FROM {{schema}}.{{usage_table}} u WHERE u.id = usage_id;
    RETURN;
  END IF;

  price := {{schema}}.{{prefix}}price_at(usage.model, usage."createdAt");
  IF price.id IS NULL THEN
    RAISE EXCEPTION 'The model % had no price when call % was made', usage.model, usage_id;
  END IF;
  SELECT * INTO ratio FROM {{schema}}.{{prefix}}dollar_rates r
    WHERE r."effectiveFrom" <= usage."createdAt"
    ORDER BY r."effectiveFrom" DESC
    LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No credits per dollar were set when call % was made', usage_id;
  END IF;

  dollars := {{schema}}.{{prefix}}call_usd(usage, price);
  cost := ceil(round(dollars * ratio."perDollar", 9));

  INSERT INTO {{schema}}.{{prefix}}balances ("userId") VALUES (usage."userId")
    ON CONFLICT ("userId") DO NOTHING;
  SELECT * INTO balance FROM {{schema}}.{{prefix}}balances b
    WHERE b."userId" = usage."userId" FOR UPDATE;
  IF balance."freeExpiresAt" IS NOT NULL AND balance."freeExpiresAt" <= now() THEN
    UPDATE {{schema}}.{{prefix}}balances b SET free = 0, "freeExpiresAt" = NULL
      WHERE b."userId" = usage."userId"
      RETURNING * INTO balance;
  END IF;

  from_free := least(greatest(balance.free, 0), cost);
  from_purchased := least(balance.purchased, cost - from_free);
  short := cost - from_free - from_purchased;

  UPDATE {{schema}}.{{prefix}}balances b
    SET free = b.free - from_free - short, purchased = b.purchased - from_purchased,
        "freeExpiresAt" = CASE
          WHEN short > 0 THEN coalesce(b."freeExpiresAt", period + interval '1 month')
          ELSE b."freeExpiresAt"
        END
    WHERE b."userId" = usage."userId";

  IF short > 0 AND cost > 0 THEN
    INSERT INTO {{schema}}.{{prefix}}pool_periods ("periodStart") VALUES (period)
      ON CONFLICT ("periodStart") DO NOTHING;
    UPDATE {{schema}}.{{prefix}}pool_periods p
      SET "overdraftUsd" = p."overdraftUsd" + dollars * short / cost
      WHERE p."periodStart" = period;
  END IF;

  RETURN QUERY
    UPDATE {{schema}}.{{usage_table}} u
      SET credits = cost,
          source = CASE WHEN from_purchased > 0 THEN 'purchased' ELSE 'free' END,
          "priceFrom" = price."effectiveFrom",
          "ratioFrom" = ratio."effectiveFrom",
          usd = dollars,
          "freeCredits" = from_free,
          "purchasedCredits" = from_purchased,
          "overdraftCredits" = short,
          "freeUsd" = CASE WHEN cost > 0 THEN dollars * (from_free + short) / cost ELSE 0 END
      WHERE u.id = usage_id
      RETURNING u.*;
END;
$$;

-- A grant or a correction, written and applied in one breath. It goes into `purchased`, which
-- never expires; a correction that would take that below nothing is refused in words rather
-- than clipped. Answers the balance as it now stands.
CREATE FUNCTION {{schema}}.{{prefix}}grant(
  user_id {{owner_id_type}}, amount bigint, reason text, admin_email text
)
RETURNS SETOF {{schema}}.{{prefix}}balances
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  balance {{schema}}.{{prefix}}balances;
BEGIN
  PERFORM {{schema}}.{{prefix}}assert_server('Credits are granted');

  IF user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM {{schema}}."{{owner_table}}" o WHERE o."{{owner_id_column}}" = user_id
  ) THEN
    RAISE EXCEPTION 'There is no user %.', coalesce(user_id::text, 'without an id')
      USING ERRCODE = 'check_violation';
  END IF;
  IF amount IS NULL OR amount = 0 THEN
    RAISE EXCEPTION 'A grant is a whole number of credits, above or below zero.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF reason IS NULL OR length(trim(reason)) = 0 THEN
    RAISE EXCEPTION 'A grant needs a reason, which the user reads beside it.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF admin_email IS NULL OR length(trim(admin_email)) = 0 THEN
    RAISE EXCEPTION 'A grant names the admin who made it.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO {{schema}}.{{prefix}}balances ("userId") VALUES (user_id)
    ON CONFLICT ("userId") DO NOTHING;
  SELECT * INTO balance FROM {{schema}}.{{prefix}}balances b WHERE b."userId" = user_id FOR UPDATE;

  IF balance.purchased + amount < 0 THEN
    RAISE EXCEPTION 'User % has % bought or granted; a correction of % would take them below nothing.',
      user_id, balance.purchased, amount
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE {{schema}}.{{prefix}}balances b SET purchased = b.purchased + amount WHERE b."userId" = user_id;
  INSERT INTO {{schema}}.{{prefix}}grants ("userId", amount, reason, "adminEmail")
    VALUES (user_id, amount, trim(reason), trim(admin_email));

  RETURN QUERY SELECT * FROM {{schema}}.{{prefix}}balances b WHERE b."userId" = user_id;
END;
$$;

-- Claiming the telling of one month's "out of credits": the where clause is the claim, so two
-- refusals at once tell the user once. Answers the row only for the call that claimed it.
CREATE FUNCTION {{schema}}.{{prefix}}claim_out_notice(user_id {{owner_id_type}})
RETURNS SETOF {{schema}}.{{prefix}}balances
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  period timestamptz := {{schema}}.{{prefix}}period(now());
BEGIN
  PERFORM {{schema}}.{{prefix}}assert_server('Notices are claimed');
  RETURN QUERY
    UPDATE {{schema}}.{{prefix}}balances b SET "notifiedFor" = period
      WHERE b."userId" = user_id AND b."notifiedFor" IS DISTINCT FROM period
      RETURNING b.*;
END;
$$;

-- The calls written to the ledger and never converted: spend refused them (a kind nobody
-- priced, no ratio yet) or the process stopped between the write and the spend. Oldest first.
-- The app hands them to spend again from a cron (`spendPending`); a row still unpriced stays
-- here until a price covers it.
CREATE FUNCTION {{schema}}.{{prefix}}pending_usage(max_rows integer DEFAULT 100)
RETURNS SETOF {{schema}}.{{usage_table}}
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  PERFORM {{schema}}.{{prefix}}assert_server('The unspent ledger is read');
  RETURN QUERY
    SELECT * FROM {{schema}}.{{usage_table}} u
      WHERE u.credits IS NULL
      ORDER BY u.id
      LIMIT greatest(coalesce(max_rows, 100), 1);
END;
$$;
