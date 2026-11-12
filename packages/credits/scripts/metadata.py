# Writes hasura/metadata/*.tmpl from the tables below. Run when a migration adds a column:
#   python3 scripts/metadata.py
import json
import os

USAGE_COLS = ["id","userId","scopeId","jobId","purpose","kind","model","activity","inputTokens","outputTokens","totalTokens","cachedTokens","cacheWriteTokens","cacheWrite1hTokens","reasoningTokens","units","requests","inferenceGeo","speed","serviceTier","source","credits","priceFrom","ratioFrom","usd","freeCredits","purchasedCredits","overdraftCredits","freeUsd","createdAt"]

# name -> (table name template, all columns, user columns or None, user filter ('own'|'all'), server writes, comment)
TABLES = {
  "usage": ("{{usage_table}}", USAGE_COLS, USAGE_COLS, "own", {"insert": [c for c in USAGE_COLS if c not in ("id","createdAt","priceFrom","ratioFrom","usd","freeCredits","purchasedCredits","overdraftCredits","freeUsd")],
             # A row is written unconverted for spend, or as the user's own key's at no credits
             # (the table's CHECK holds own to 0); never as already paid from a balance.
             "insert_check": "\n        _or:\n          - _and:\n              - source:\n                  _is_null: true\n              - credits:\n                  _is_null: true\n          - source:\n              _eq: own"},
            "One row per metered call: what it used and, once spent, what it cost in credits and dollars and where they came from."),
  "balances": ("{{prefix}}balances", ["userId","free","purchased","freeExpiresAt","notifiedFor","updatedAt"], ["userId","free","purchased","freeExpiresAt","updatedAt"], "own", {"update": ["notifiedFor"]},
            "A user's credits: what is left of the free ones and when they expire, and what was bought or granted. Moved only by the row-locked functions."),
  "settings": ("{{prefix}}settings", ["id","allotment","updatedAt"], None, None, {"update": ["allotment"]},
            "What the deployment hands out: the most free credits one user gets a month."),
  "model_prices": ("{{prefix}}model_prices", ["id","model","effectiveFrom","longPromptUnits","longPromptFactor","source","syncedAt"], ["id","model","effectiveFrom","longPromptUnits","longPromptFactor"], "all", {"update": ["syncedAt"]},
            "One price version of one model, from a moment on; its kinds are model_price_kinds. Set through set_model_price."),
  "model_price_kinds": ("{{prefix}}model_price_kinds", ["priceId","kind","unit","usdPerMillion","derived"], ["priceId","kind","unit","usdPerMillion","derived"], "all", {},
            "What one kind of usage costs under a price, in US dollars per million units; derived kinds were worked out from a fallback when the price was set."),
  "kind_fallbacks": ("{{prefix}}kind_fallbacks", ["kind","baseKind","multiple"], None, None, {"insert": ["kind","baseKind","multiple"], "update": ["baseKind","multiple"], "delete": True},
            "A kind a price leaves out, worked out from another when a price is set. Defaults for prices set from then on; never reprices a stored version."),
  "price_factors": ("{{prefix}}price_factors", ["id","model","dimension","value","factor","effectiveFrom"], None, None, {"insert": ["model","dimension","value","factor","effectiveFrom"]},
            "Multiples a request is priced at for one value of one of its dimensions."),
  "dollar_rates": ("{{prefix}}dollar_rates", ["perDollar","effectiveFrom"], ["perDollar","effectiveFrom"], "all", {"insert": ["perDollar","effectiveFrom"]},
            "How many credits a dollar of a provider's price comes to, from a moment on."),
  "pool_budgets": ("{{prefix}}pool_budgets", ["effectiveFrom","budgetUsd","adminEmail"], None, None, {"insert": ["budgetUsd","adminEmail"]},
            "What the admin spends on free credits a month, in US dollars, from a moment on."),
  "pool_periods": ("{{prefix}}pool_periods", ["periodStart","grantedCredits","grantedUsd","overdraftUsd","providerCents","ledgerCents","driftFactor","checkedAt","notifiedLowAt","notifiedEmptyAt","notifiedOverAt","updatedAt"], None, None, {"insert": ["periodStart","providerCents","ledgerCents","driftFactor","checkedAt"], "update": ["providerCents","ledgerCents","driftFactor","checkedAt","notifiedLowAt","notifiedEmptyAt","notifiedOverAt"]},
            "One month of the pool: what has come out of it. Granted and overdraft amounts move only in admit and spend."),
  "free_grants": ("{{prefix}}free_grants", ["id","userId","periodStart","credits","usd","ratioFrom","kind","createdAt"], ["id","userId","periodStart","credits","createdAt"], "own", {},
            "Every handout of free credits from the pool."),
  "grants": ("{{prefix}}grants", ["id","userId","amount","reason","adminEmail","createdAt"], ["id","userId","amount","reason","createdAt"], "own", {},
            "The admin granting credits or taking some back. The user reads their own, never which admin."),
  "own_backends": ("{{prefix}}own_backends", ["userId","baseUrl","keyCiphertext","keyLast4","models","toolChoice","tokenLimit","order","limitNotifiedFor","updatedAt"], ["userId","baseUrl","keyLast4","models","toolChoice","tokenLimit","order","updatedAt"], "own", {"insert": ["userId","baseUrl","keyCiphertext","keyLast4","models","toolChoice","tokenLimit","order"], "update": ["baseUrl","keyCiphertext","keyLast4","models","toolChoice","tokenLimit","order","limitNotifiedFor"], "delete": True},
            "A user's own model. The sealed key is never selectable by any role but the server."),
  "sale_prices": ("{{prefix}}sale_prices", ["currency","centsPerMillion","effectiveFrom"], ["currency","centsPerMillion","effectiveFrom"], "all", {"insert": ["currency","centsPerMillion"]},
            "What a million credits cost in a currency, from a moment on."),
  "stripe_events": ("{{prefix}}stripe_events", ["id","type","purchaseId","receivedAt"], None, None, {},
            "Every Stripe event that credited anything, so a replay credits nothing."),
  "purchases": ("{{prefix}}purchases", ["id","userId","kind","stripeId","currency","amountCents","taxCents","totalCents","credits","priceFrom","status","failure","createdAt","paidAt"], ["id","userId","kind","currency","amountCents","taxCents","totalCents","credits","priceFrom","status","failure","createdAt","paidAt"], "own", {"update": ["stripeId","taxCents","totalCents"]},
            "One purchase or automatic refill, opened before Stripe is asked and paid only by the webhook."),
  "autorefill": ("{{prefix}}autorefill", ["userId","enabled","thresholdCredits","amountCents","currency","monthlyMaxCents","stripeCustomerId","paymentMethodId","paymentMethodLabel","pending","failedAt","updatedAt"], ["userId","enabled","thresholdCredits","amountCents","currency","monthlyMaxCents","paymentMethodLabel","pending","failedAt","updatedAt"], "own", {"insert": ["userId","enabled","thresholdCredits","amountCents","currency","monthlyMaxCents","stripeCustomerId","paymentMethodId","paymentMethodLabel","failedAt"], "update": ["enabled","thresholdCredits","amountCents","currency","monthlyMaxCents","stripeCustomerId","paymentMethodId","paymentMethodLabel","failedAt"]},
            "A user's automatic refill. The user reads which card by its label, never Stripe's ids."),
  "price_proposals": ("{{prefix}}price_proposals", ["id","model","kinds","longPromptUnits","longPromptFactor","factors","sources","problems","proposedAt","status","decidedAt","notifiedAt"], None, None, {"insert": ["model","kinds","longPromptUnits","longPromptFactor","factors","sources","problems"], "update": ["status","decidedAt","notifiedAt"]},
            "Prices proposed by a sync, waiting for the admin."),
  "cost_reconciliations": ("{{prefix}}cost_reconciliations", ["id","periodStart","periodEnd","model","report","complete","providerCents","ledgerCents","providerByKind","ledgerByKind","drift","ledgerCalls","ledgerCredits","checkedAt","notifiedAt"], None, None, {"insert": ["periodStart","periodEnd","model","report","complete","providerCents","ledgerCents","providerByKind","ledgerByKind","drift","ledgerCalls","ledgerCredits"], "update": ["periodEnd","complete","providerCents","ledgerCents","providerByKind","ledgerByKind","drift","ledgerCalls","ledgerCredits","checkedAt","notifiedAt"]},
            "One stretch of one model checked against the provider's cost report."),
}

def cols(lst, indent):
    return "".join(f"{' '*indent}- {c}\n" for c in sorted(lst))

out = "hasura/metadata/tables"
os.makedirs(out, exist_ok=True)
for name, (table, allc, userc, filt, writes, comment) in TABLES.items():
    y = f"table:\n  name: {table}\n  schema: {{{{schema}}}}\nconfiguration:\n  comment: {json.dumps(comment)}\n"
    if "userId" in allc:
        y += "object_relationships:\n  - name: owner\n    using:\n      foreign_key_constraint_on: userId\n"
    if name == "model_prices":
        y += "array_relationships:\n  - name: kinds\n    using:\n      foreign_key_constraint_on:\n        column: priceId\n        table:\n          name: {{prefix}}model_price_kinds\n          schema: {{schema}}\n"
    if name == "insert" and False: pass
    y += "insert_permissions:\n" if "insert" in writes else ""
    if "insert" in writes:
        y += f"  - role: {{{{server_role}}}}\n    permission:\n      check:{writes.get('insert_check', ' {}')}\n      columns:\n{cols(writes['insert'], 8)}    comment: The server's own writes. No other role ever writes here.\n"
    y += "select_permissions:\n"
    y += f"  - role: {{{{server_role}}}}\n    permission:\n      columns:\n{cols(allc, 8)}      filter: {{}}\n      allow_aggregations: true\n    comment: The server reads everything here.\n"
    if userc:
        f = "\n        userId:\n          _eq: X-Hasura-User-Id" if filt == "own" else " {}"
        why = "A user's own rows, and nobody else's. Never widen it, and never give any AI role a permission here." if filt == "own" else "Prices are public to a signed-in user, for the screens. No AI role reads this."
        y += f"  - role: {{{{user_role}}}}\n    permission:\n      columns:\n{cols(userc, 8)}      filter:{f}\n    comment: {json.dumps(why)}\n"
    if "update" in writes:
        y += f"update_permissions:\n  - role: {{{{server_role}}}}\n    permission:\n      columns:\n{cols(writes['update'], 8)}      filter: {{}}\n      check: null\n    comment: The server's bookkeeping. Balances and money move only in the row-locked functions.\n"
    if writes.get("delete"):
        y += "delete_permissions:\n  - role: {{server_role}}\n    permission:\n      filter: {}\n    comment: The server alone.\n"
    open(f"{out}/{name}.yaml.tmpl","w").write(y)

FUNCS = [
  ("admit", "Admits a user, handing them free credits from the month's pool when nothing is left. Answers the balance; above zero is admitted."),
  ("spend", "One ledger row converted into credits at the price and ratio in force when it was made, and taken free first. Idempotent."),
  ("grant", "The admin granting credits or taking some back, never below nothing, written down with the reason and the admin."),
  ("claim_out_notice", "Claims telling a user they ran out this month; answers the row only for the call that claimed it."),
  ("set_model_price", "A model's price set whole, from a moment on."),
  ("purchase_open", "A purchase opened at the price in force, before Stripe is asked."),
  ("refill_claim", "Claims an automatic refill if one is due, one at a time and within the month's maximum."),
  ("credit", "Credits what Stripe says was paid, once per event id and once per purchase."),
  ("refill_failed", "A refill that could not be charged: failed, auto-refill turned off."),
  ("apply_proposal", "A proposed price applied from now."),
]
f = ""
for name, comment in FUNCS:
    f += f"- function:\n    name: {{{{prefix}}}}{name}\n    schema: {{{{schema}}}}\n  configuration:\n    exposed_as: mutation\n  permissions:\n    - role: {{{{server_role}}}}\n  comment: {json.dumps(comment + " The server role alone, and the function checks the role again itself. Never add a user-facing or AI role.")}\n"
open("hasura/metadata/functions.yaml.tmpl","w").write(f)
