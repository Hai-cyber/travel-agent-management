# Temporary Free Beta Ops Model

This note documents the current beta operating model. It is intentionally conservative and temporary: it lets the product run now without removing the paths needed for later online payments, automated reconciliation, or a reactivated domain/commercial flow.

## Core Policy

- For the current beta, Tours Market does not collect booking money from travelers.
- Travelers pay each tenant directly.
- The tenant must receive funds in the tenant's own Wise account or bank account.
- Tours Market currently stores booking state, proof-of-payment, and the tenant's manual confirmation action.
- Cloudflare Registrar code stays in the repo, but the public UI should hide the domain-purchase surface until the platform intentionally reactivates that flow.
- This is a temporary operating boundary for the beta, not a permanent product limitation.

## Why This Is Temporary

- The current model keeps legal, support, KYC, and reconciliation load low while the product is still validating.
- It preserves the booking core and domain infrastructure without forcing premature platform-led fulfillment or money movement.
- It leaves room for future tenant-owned online gateways, webhook-driven confirmations, and broader automation when policy and operations are ready.

## Booking SOP

### Allowed money flow

- In the current beta, the traveler pays the tenant directly.
- The receiving account must belong to the tenant, not Tours Market.
- Wise is acceptable only as the tenant's own receiving rail.

### Booking flow

1. Traveler places a booking.
2. The platform creates the order in `AWAITING_PROOF` for manual-payment methods.
3. The traveler receives the tenant's payment instructions.
4. The traveler sends the transfer and uploads proof.
5. The platform moves the order to `PROOF_UPLOADED`.
6. The tenant checks the tenant-owned Wise or bank account.
7. The tenant confirms receipt manually only after funds are actually visible as settled.
8. The platform moves the order to `CONFIRMED` and unlocks identity.

### Manual confirmation rules

- Do not confirm from screenshot alone.
- Confirm only when the tenant can see the incoming payment in the tenant-owned account.
- Match at least these fields before confirmation:
  - booking amount due
  - booking currency
  - order reference or payer detail when available
- If proof exists but money is not yet visible, keep the order unconfirmed.
- If the deadline passes with no valid payment, let the order expire or cancel it manually.

### Operational notes

- This model is intentionally manual for the current beta.
- The goal is a professional guest flow without making Tours Market the merchant, marketplace, or payment intermediary.
- Any future automation should be layered onto the current booking state machine, not added by rewriting the booking core.
- A sensible later sequence would be: tenant-owned electronic gateway, webhook-driven payment confirmation, automatic reminders and expiry handling, then manual exception handling only where needed.
- The current manual checkpoints are therefore temporary operational controls, not proof that the long-term product must stay manual.

## Domain Policy

### Beta rule

- For the current beta, tenants buy their own domain from Cloudflare or any registrar they choose.
- Tours Market only supports BYOD verification and go-live.
- The existing CF Registrar purchase flow remains dormant in code and should be hidden in UI.
- This is the current safety boundary, not a statement that assisted domain purchase can never return.

### Why this boundary matters

- Accepting money for domain purchases would make the platform responsible for a separate fulfillment flow.
- Domain search does not reserve inventory.
- Price, availability, registrant ownership, and refunds create manual support and legal friction quickly.
- Hiding the UI is lower-risk than deleting the implementation because the code can be revived later.

## Future Expansion Path

### Online payments later

- Keep traveler funds going to the tenant, but allow approved electronic gateways later when policy, support, and compliance are ready.
- Use gateway or payment-provider webhooks to update booking payment state automatically.
- Keep manual review as a fallback for exceptions, disputes, or offline transfers.

### Automation later

- Auto-match amount, currency, and payment reference against the expected order.
- Auto-send reminders, confirmations, and follow-up notices.
- Auto-expire unpaid orders and reduce manual admin work around proof review.

### Domain and commercial flows later

- Reactivate assisted domain purchase or other platform-managed commercial steps only behind feature flags and only when pricing, refund, and support ownership are clear.
- Reuse the existing Cloudflare Registrar code path instead of rebuilding from zero.

## UI Audit For Small Future Edits

These surfaces currently send the wrong signal for the current beta model and should be hidden or rewritten until the online-payment and automated-commerce paths are intentionally reactivated.

### Hide, do not delete

- `public/dashboard.html`
  - Around the domain panel, the UI still exposes platform-led registration:
    - `Register a New Domain`
    - `Registration includes automatic DNS setup — your domain is live immediately after payment`
  - The wizard still offers `Register new domain` with `CF cost + 30% platform fee` language.
  - This should be hidden behind a later feature flag while keeping the backend intact for future reactivation.

### Rewrite later

- `public/dashboard.html`
  - `Complete these steps to activate your commercial storefront.`
  - This still frames the beta as platform-run commerce instead of a temporary tenant-direct collection model.

- `public/dashboard.html`
  - Terms copy currently says:
    - monthly subscription fee applies
    - platform commission applies
    - electronic gateway is required
    - bank transfer is supplementary only
  - That is misaligned with the intended beta model.

- `public/dashboard.html`
  - Payment-gateway step currently says customers can pay online, bookings are trackable and commissionable, and bank transfer is supplementary only.
  - For the current beta this should be reframed around tenant-direct collection and manual confirmation, while still leaving room to reintroduce online payment automation later.

- `public/terms.html`
  - Section 6 still states paid subscription billing via platform processor and month-end platform commission.
  - This is stale if the beta runs as free access with no active billing.

- `public/privacy.html`
  - The privacy policy still says subscription billing is processed via Stripe.
  - That becomes inaccurate if platform billing is disabled during beta.

### Already aligned enough to keep

- `public/pricing.html`
  - The FAQ already states that customers pay the tenant directly and Tours Market is not a payment processor or marketplace.
  - This is directionally correct for the current beta model.

## Backend Surfaces To Preserve

- `src/routes/domains.js`
  - Keep the CF Registrar purchase flow in place for later use.
  - Do not surface it publicly during beta.

- `src/routes/tenants.js`
  - Keep the custom-domain verification flow as the active domain path.
  - This remains useful even when platform-led registration is hidden.

- `src/routes/bookings.js`
  - Keep the existing `AWAITING_PROOF` -> `PROOF_UPLOADED` -> `CONFIRMED` manual-confirmation flow.
  - This matches the tenant-direct payment model.

## Minimal Current Change Set

While this temporary beta model remains active, prefer the smallest possible changes:

1. Hide the dashboard domain-registration CTA and panel.
2. Keep the BYOD custom-domain section visible.
3. Replace beta-inaccurate terms in the dashboard wizard so they describe the current temporary model without implying it is permanent.
4. Leave `src/routes/domains.js` untouched unless the feature is being reactivated.
5. Avoid rewriting booking state machinery; future online payment or automation should layer onto the existing state flow.