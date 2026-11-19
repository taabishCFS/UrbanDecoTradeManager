# Manual Trade Account Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the merchant add a trade account by hand; it creates a MANUAL `TradeApplication` and optionally approves it immediately through the same approval code the Approve button uses.

**Architecture:** Extract the approve logic from the `approve` branch of `app/routes/app.trade-applications.$id.jsx` into `app/services/approve-application.server.js` with no behaviour change, proven by characterization tests written *before* the move. A new service creates the manual application and calls that shared function; a new route `app.trade-accounts.new.jsx` is the form.

**Tech Stack:** React Router 7 (file routes), Prisma 6 / Postgres, Vitest (`tests/**/*.test.js`, node env, mock modules with `vi.mock`), Resend email via `app/services/email.server.js`.

**Spec:** `docs/superpowers/specs/2026-11-19-manual-trade-account-design.md`

## Global Constraints

- The existing flow "approved application becomes a trade account" must not change: same Shopify customer find/reuse/create + `TRADE_ACCOUNT` tag, same referral code (`UD-XXXXXX`), same Prisma transaction (TradeAccount `ACTIVE`, discount/commission 0, application `APPROVED` + `approvedAt`), same rollback rules, same `sendTradeApprovalEmail(application)` call (email failure never fails approval), same JSON bodies and HTTP status codes.
- Schema change is additive only: `TradeApplication.source String @default("FORM")`, values `FORM` | `MANUAL`.
- Required manual fields: first name, last name, email, business name. Everything else optional. Non-null columns not collected (phone, address, city, postcode, businessType) store `""`. `termsAccepted` is `false`. Notes go in `projectInformation`.
- Checkbox label "Approve and send welcome email now", default checked; unchecked → application saved `PENDING`.
- Do not add a TradeAccount without a TradeApplication. No changes to the public application form.
- Commits: follow repo style (`feat:`/`refactor:`/`test:`), end message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Do not run `prisma migrate` against a real database; run `npx prisma generate` only and tell the user to run `npm run setup`.

## Review Focus

1. Approve-now with a missing/invalid phone: the existing approval rejects it (needs E.164-normalisable phone). Form must reject up front when "approve now" is ticked, creating nothing. (Task 4)
2. Email differing only by case/whitespace from an existing application → treated as duplicate; message names the existing application's status and links to it. (Task 4)
3. Shopify/approval failure after the application was created: application stays `PENDING` (retryable via Approve button), error is shown, no orphan Shopify customer. (Task 4)
4. Malformed email (`"ada@"`) and whitespace-only required fields rejected with per-field messages. (Task 4)
5. Existing approve for an application with `source: "FORM"` still behaves identically after the refactor, including already-approved (400) and existing-account (400) cases. (Tasks 2, 3)

---

### Task 1: Add `source` column

**Files:**
- Modify: `prisma/schema.prisma` (model `TradeApplication`, after `status`)
- Create: `prisma/migrations/20261119120000_add_application_source/migration.sql`

**Interfaces:**
- Produces: `TradeApplication.source: string` (`"FORM"` default, `"MANUAL"`).

- [ ] **Step 1:** Add `source String @default("FORM")` with a `// FORM | MANUAL` comment to `TradeApplication`.
- [ ] **Step 2:** Write the migration: `ALTER TABLE "TradeApplication" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'FORM';`
- [ ] **Step 3:** Run `npx prisma generate` (expected: client generated, no errors) and `npx prisma validate` (expected: valid).
- [ ] **Step 4: Commit** `feat: add source column to trade applications`

### Task 2: Characterization tests for the existing approve action

Written against the **current, unrefactored** route so they pin today's behaviour.

**Files:**
- Create: `tests/approve-application.test.js`

**Interfaces:**
- Consumes: `action({ request, params })` exported from `app/routes/app.trade-applications.$id.jsx`; mock `../app/db.server.js` (default export `prisma`), `../app/shopify.server.js` (`authenticate.admin` → `{ admin }`), `../app/services/email.server.js` (`sendTradeApprovalEmail`, `sendTradeRejectionEmail`). `admin.graphql` is a `vi.fn` that answers by inspecting the query string (customer search → no customers, `customerCreate` → customer `gid://shopify/Customer/1`, tag/delete mutations → success); read `findExistingShopifyCustomer`, `addTradeAccountTag`, `deleteShopifyCustomer` in the route to get the response shapes right. `prisma.$transaction` mock invokes its callback with a `tx` exposing `tradeAccount.create` and `tradeApplication.update`.
- Produces: a helper in the test `callApprove(application)` returning `{ status, body }` from `await response.json()`.

- [ ] **Step 1: Write tests** (each posts `FormData` `action=approve`):
  - `approves a pending application` → 200, `body.success === true`, `body.action === "approve"`, `body.referralCode` matches `/^UD-[A-Z0-9]{6}$/`, `tradeAccount.create` called with `{ applicationId, email, businessName, discountPercent: 0, commissionPercent: 0, status: "ACTIVE", shopifyCustomerId }`, `tradeApplication.update` called with `status: "APPROVED"`, `sendTradeApprovalEmail` called once with the application.
  - `returns 400 when already approved` (status `APPROVED`) and no Shopify calls.
  - `returns 400 when application has no phone` / `invalid phone` (message contains "invalid").
  - `returns 400 when a trade account already exists`.
  - `reuses an existing Shopify customer` (search returns one) → message ends "using an existing Shopify customer.", no `customerCreate` call.
  - `rolls back created customer when transaction fails` → 500, `rollbackSuccessful: true`, a `customerDelete` mutation was sent.
  - `still succeeds when approval email throws`.
- [ ] **Step 2:** Run `npx vitest run tests/approve-application.test.js` → all PASS against the unmodified route (if one fails, fix the test, not the route).
- [ ] **Step 3: Commit** `test: characterize existing trade application approval`

### Task 3: Extract approval into a shared service (no behaviour change)

**Files:**
- Create: `app/services/approve-application.server.js`
- Modify: `app/routes/app.trade-applications.$id.jsx` (remove moved helpers; `approve` branch and `deleteCustomer` branch call the service)

**Interfaces:**
- Produces (exports of `approve-application.server.js`):
  - `approveApplication({ admin, application }): Promise<{ status: number, body: object }>` — contains everything now inside `if (actionType === "approve") { ... }` (lines ~1186–1970: already-approved check, phone/email validation, existing-account check, Shopify find/reuse/create, referral code, transaction, approval email, rollback), returning the exact JSON body and status the route returned before (200 on success).
  - `deleteShopifyCustomer(admin, customerId): Promise<boolean>` (still used by `deleteCustomer`).
  - `normalisePhone(phone): string | null`.
  - Also moved, not exported: `generateReferralCode`, `findExistingShopifyCustomer`, `addTradeAccountTag`, `removeTradeAccountTag`. If the route still uses any of these elsewhere, export it instead of duplicating.
- Consumes: `prisma` from `../db.server`, `sendTradeApprovalEmail` from `./email.server`.

- [ ] **Step 1:** Move the helpers and the approve body verbatim into the service; replace `return Response.json(body, { status })` with `return { status, body }`. Keep all logging.
- [ ] **Step 2:** In the route, `if (actionType === "approve") { const r = await approveApplication({ admin, application }); return Response.json(r.body, { status: r.status }); }`. Update imports (drop `sendTradeApprovalEmail` if unused; keep `sendTradeRejectionEmail`).
- [ ] **Step 3:** Run `npx vitest run` → Task 2 tests still PASS unchanged, existing suite PASS.
- [ ] **Step 4:** Run `npm run build` → succeeds.
- [ ] **Step 5: Commit** `refactor: extract trade application approval into shared service`

### Task 4: Manual trade account service

**Files:**
- Create: `app/services/manual-trade-account.server.js`
- Test: `tests/manual-trade-account.test.js`

**Interfaces:**
- Consumes: `approveApplication` (Task 3), `normalisePhone`, `prisma`.
- Produces:
  - `validateManualTradeAccount(input): { errors: Record<string,string>, values: object }` — pure. `input` keys: `firstName, lastName, email, businessName, phone, businessType, website, instagram, companyNumber, vatNumber, address, city, county, postcode, country, notes, approveNow` (boolean). `values` has trimmed strings, lower-cased email. Errors keyed by field: required fields, email format, and `phone` when `approveNow` and `normalisePhone(phone)` is null.
  - `createManualTradeAccount({ admin, input }): Promise<{ ok: true, application, approved: boolean, message: string } | { ok: false, errors?: Record<string,string>, duplicateOf?: { id: string, status: string }, message: string, application?: object }>`.

- [ ] **Step 1: Write failing tests** (mock `prisma` and `approveApplication`):
  - `validate: requires first name, last name, email, business name` (blank/whitespace → each key present).
  - `validate: rejects malformed email "ada@"`.
  - `validate: lower-cases and trims email`.
  - `validate: phone only required/validated when approveNow` (invalid phone + approveNow=false → no `phone` error; approveNow=true → `phone` error).
  - `create: blocks duplicate email case-insensitively` → `ok:false`, `duplicateOf` `{id,status}`, `tradeApplication.create` not called, `approveApplication` not called.
  - `create: approveNow=false saves PENDING manual application` → `tradeApplication.create` data includes `source: "MANUAL"`, `status: "PENDING"`, `termsAccepted: false`, `phone: ""` when blank, `address: ""`, `projectInformation: notes`; `approveApplication` not called; `ok:true, approved:false`.
  - `create: approveNow=true calls approveApplication with the created application` → `ok:true, approved:true` when it returns `{status:200,...}`.
  - `create: approval failure keeps application PENDING` → `approveApplication` returns `{status:500, body:{message:"boom"}}` → `ok:false`, `application` returned, message includes "boom", `tradeApplication.delete` never called.
- [ ] **Step 2:** Run `npx vitest run tests/manual-trade-account.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement both functions. Duplicate check: `prisma.tradeApplication.findFirst({ where: { email: { equals: values.email, mode: "insensitive" } } })`.
- [ ] **Step 4:** Run the test file → PASS; run `npx vitest run` → all PASS.
- [ ] **Step 5: Commit** `feat: add manual trade account service`

### Task 5: Route, button and badge

**Files:**
- Create: `app/routes/app.trade-accounts.new.jsx`
- Modify: `app/routes/app.trade-accounts._index.jsx` (button + Manual badge), `app/routes/app.trade-accounts.$id.jsx` and `app/routes/app.trade-applications.$id.jsx` / `_index.jsx` (Manual badge where the application is shown; read each loader to confirm `source` is selected/available)

**Interfaces:**
- Consumes: `createManualTradeAccount`, `authenticate.admin`.
- Produces: route `/app/trade-accounts/new` with `action` returning `{ ok, errors, message, duplicateOf }` and, on `ok`, `redirect` to `/app/trade-accounts` if approved or `/app/trade-applications/${application.id}` if saved pending. Duplicate message links to `/app/trade-applications/${duplicateOf.id}`.

- [ ] **Step 1:** Build the form (react-router `Form`, inline styles matching `app.trade-accounts._index.jsx`): required fields marked, optional fields grouped (contact, business, address, notes), checkbox `approveNow` default checked, field-level errors from `actionData.errors`, submit button disabled while submitting, Cancel link back to the list.
- [ ] **Step 2:** Add an "Add trade account" link-button to the Trade Accounts list header, and a small "Manual" badge next to business name where `application.source === "MANUAL"` (include `source` in the Prisma `select`/include if the query selects explicit fields).
- [ ] **Step 3:** Run `npm run build` → succeeds; `npm run lint` → no new errors in touched files.
- [ ] **Step 4:** Run `npx vitest run` → all PASS.
- [ ] **Step 5: Commit** `feat: add manual trade account form`

### Task 6: End-to-end verification

- [ ] **Step 1:** Ask the user to run `npm run setup` (applies the migration) and `npm run dev`.
- [ ] **Step 2:** Walk through with the user (dev store): (a) manual, checkbox on, valid phone → customer tagged, account listed with Manual badge, referral code present, approval email in Emails thread; (b) manual, checkbox off → Pending application, later Approve button works; (c) duplicate email → blocked with link; (d) invalid phone + checkbox on → field error, nothing created; (e) approve a normal form-submitted pending application → behaves as before.
- [ ] **Step 3:** Report results faithfully, including anything not verified.
