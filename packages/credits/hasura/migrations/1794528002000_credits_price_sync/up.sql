-- @kaperkunde/credits: prices proposed by a sync from public price feeds, decided by the admin,
-- and a check of the ledger against what the provider says the calls really cost.
--
-- Every call is priced from the stored, dated prices, never from a fetch on the way. A sync
-- proposes a price where the feeds disagree with the one in force -- nothing more. Applying one
-- writes a new price from that moment, so nothing already made is charged again. One proposal
-- waits per model; a newer one replaces it.

CREATE TABLE {{schema}}.{{table_price_proposals}} (
  id bigserial PRIMARY KEY,
  model text NOT NULL,
  -- The price proposed, as set_model_price takes it: [{"kind", "unit", "usdPerMillion"}].
  kinds jsonb NOT NULL,
  "longPromptUnits" bigint NULL CHECK ("longPromptUnits" > 0),
  "longPromptFactor" numeric NULL CHECK ("longPromptFactor" > 0),
  -- The model's own factors proposed with it: [{"dimension", "value", "factor"}].
  factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The feeds that said so, and what the sync found odd about it, in words.
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  problems jsonb NOT NULL DEFAULT '[]'::jsonb,
  "proposedAt" timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT {{prefix}}price_proposals_status_check
      CHECK (status IN ('pending', 'applied', 'dismissed', 'replaced')),
  "decidedAt" timestamptz NULL,
  -- When the admin was told of it; claimed before the telling.
  "notifiedAt" timestamptz NULL
);

CREATE UNIQUE INDEX {{prefix}}price_proposals_one_pending
  ON {{schema}}.{{table_price_proposals}} (model) WHERE status = 'pending';

-- One stretch of time for one model checked against the provider's cost report: what it says
-- the stretch cost, what the ledger comes to at the prices in force, and how far apart, by
-- kind. A stretch checked again replaces its figures.
CREATE TABLE {{schema}}.{{table_cost_reconciliations}} (
  id bigserial PRIMARY KEY,
  "periodStart" timestamptz NOT NULL,
  "periodEnd" timestamptz NOT NULL,
  model text NOT NULL,
  -- Which report said it, as the app names it.
  report text NOT NULL,
  complete boolean NOT NULL DEFAULT false,
  "providerCents" numeric NOT NULL DEFAULT 0,
  "ledgerCents" numeric NOT NULL DEFAULT 0,
  "providerByKind" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ledgerByKind" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Signed: (provider - ledger) / the larger of the two; null where both are nothing.
  drift numeric NULL,
  "ledgerCalls" bigint NOT NULL DEFAULT 0,
  "ledgerCredits" bigint NOT NULL DEFAULT 0,
  "checkedAt" timestamptz NOT NULL DEFAULT now(),
  "notifiedAt" timestamptz NULL,
  CONSTRAINT {{prefix}}cost_reconciliations_period_model UNIQUE ("periodStart", model)
);

-- Applying a proposal: the price from now, its model's factors with it, the proposal marked.
-- Answers the new price; nothing for a proposal no longer pending.
CREATE FUNCTION {{schema}}.{{prefix}}apply_proposal(proposal_id bigint)
RETURNS SETOF {{schema}}.{{table_model_prices}}
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  proposal {{schema}}.{{table_price_proposals}};
  price {{schema}}.{{table_model_prices}};
  entry jsonb;
BEGIN
  PERFORM {{schema}}.{{prefix}}assert_server('Prices are set');
  SELECT * INTO proposal FROM {{schema}}.{{table_price_proposals}} p
    WHERE p.id = proposal_id FOR UPDATE;
  IF NOT FOUND OR proposal.status <> 'pending' THEN
    RETURN;
  END IF;
  SELECT * INTO price FROM {{schema}}.{{prefix}}set_model_price(
    proposal.model, proposal.kinds, proposal."longPromptUnits", proposal."longPromptFactor",
    left(coalesce((SELECT string_agg(s, ' + ') FROM jsonb_array_elements_text(proposal.sources) s), 'sync'), 80),
    now(), now()
  );
  FOR entry IN SELECT value FROM jsonb_array_elements(proposal.factors) LOOP
    INSERT INTO {{schema}}.{{table_price_factors}} (model, dimension, value, factor, "effectiveFrom")
      VALUES (proposal.model, entry ->> 'dimension', entry ->> 'value', (entry ->> 'factor')::numeric, now());
  END LOOP;
  UPDATE {{schema}}.{{table_price_proposals}} p SET status = 'applied', "decidedAt" = now()
    WHERE p.id = proposal_id;
  RETURN NEXT price;
END;
$$;
