# Manual Trade Account Creation — Design

## Intent
Merchants sometimes get trade enquiries outside the Shopify trade application form (email, phone, in person). They need to add that business as a trade account by hand, with the same result as an approved application: Shopify customer, referral code, TradeAccount, approval email.

## Goals
- "Add trade account" button on the Trade Accounts list opens a form.
- Manual entries create a `TradeApplication` (flagged manual) and approve it through the same path as normal approvals, so emails, detail pages and lists keep working.
- Checkbox "Approve and send welcome email now" (default on). Unticked → saved as PENDING, approved later with the existing Approve button.

## Non-goals
- No changes to the public application form or its behaviour.
- No TradeAccount without a TradeApplication.
- No bulk/CSV import.

## Anti-goals (failure even if it "works")
- **Any change to the existing flow where an approved application becomes a trade account.** The Approve button must behave exactly as today: same Shopify customer find/reuse/create, tagging, referral code, transaction, rollback, and email.

## Approaches
- **A (chosen):** extract the approval logic into a shared server module used by both the existing Approve action and the new manual form. One approval path; requires a careful no-behaviour-change refactor.
- B: create as Pending and redirect to the existing Approve button. Smallest change but "approve now" isn't one click.
- C: duplicate approval code. Rejected: two copies of rollback logic drift.

## Design
1. **Schema:** add `TradeApplication.source String @default("FORM")` (`FORM` | `MANUAL`). Existing rows default to `FORM`. Migration is additive only.
2. **Shared module** `app/services/approve-application.server.js`: moves `generateReferralCode`, Shopify customer helpers, and the approve steps (customer find/reuse/create → referral code → transaction → rollback → approval email) out of `app.trade-applications.$id.jsx` verbatim. `$id` action calls it; response shapes and status codes unchanged.
3. **New route** `app.trade-accounts.new.jsx`: form + action.
   - Required: first name, last name, email, business name. Optional: phone, business type, website, Instagram, VAT/company number, address fields, notes (stored in `projectInformation`).
   - Schema columns that are non-null but not collected (phone, address, city, postcode, businessType) store `""` (my call; avoids loosening columns). `termsAccepted` is set to `false` for manual entries.
   - Rejects an email that already has an application or account (clear error).
   - Creates application with `source: MANUAL`, status PENDING; if checkbox ticked, calls the shared approval function. If approval fails, Shopify changes are rolled back by the shared code and the application is removed (or left PENDING with an error shown — builder to pick the one matching the existing failure behaviour).
4. **UI:** "Add trade account" button on `app.trade-accounts._index.jsx`; "Manual" badge on rows/detail where `source === "MANUAL"`.

## Verification
- Existing approval: approve a normal pending application before/after the refactor; identical outcome.
- Manual with checkbox on: customer, account, referral code, email created.
- Manual with checkbox off: PENDING application appears in Applications; Approve works later.
- Duplicate email blocked; Shopify failure leaves no orphan customer/account.

## Left to the builder
Exact form layout (match existing Polaris/admin styling), email-failure handling parity with the existing flow, and the migration command per this repo's Prisma setup.
