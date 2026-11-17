# Trade Email Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Emails page where the merchant sees every applicant's email trail, reads the latest or the whole thread, and replies from the app, with applicant replies arriving through a Resend inbound webhook and a copy forwarded to `trade@`.

**Architecture:** An `EmailMessage` table logs applicant-facing mail in both directions. A thin public webhook route verifies the Resend signature and hands the event to a dependency-injected `processInboundEmail` service. Three embedded pages (list, thread, unmatched) read through small query helpers. Pure text helpers hold the quote cleaning and address parsing so they can be unit tested.

**Tech Stack:** React Router 7 flat routes, Prisma 6 + PostgreSQL, Resend 6 (`webhooks.verify`, `emails.receiving.get`), Vitest (new dev dependency).

**Spec:** `docs/superpowers/specs/2026-11-17-trade-email-trail-design.md`

## Global Constraints

- Applicant emails are stored lowercase; match senders by lowercase comparison.
- Mail sends from `EMAIL_FROM` (default `Urban Deco Trade <trade@urbandeco.co.uk>`).
- Reply-to on every applicant-facing email is `EMAIL_REPLY_TO`; if unset, fall back to the address inside `EMAIL_FROM`.
- Reply copies go to `REPLY_COPY_TO`, default the address inside `EMAIL_FROM`, never to the inbound address (no loop).
- New env vars: `EMAIL_REPLY_TO`, `RESEND_WEBHOOK_SECRET`, `REPLY_COPY_TO` (optional).
- Plain text only, no attachments. Message bodies render as escaped text, never raw HTML.
- Team alert emails are not logged. Logging failures never fail a send.
- Webhook route lives at `/webhooks/resend`, outside `/app`, no Shopify admin session.
- Existing code style: ES modules, `*.server.js` for server code, inline style objects and `Form`/`Link` from `react-router` in pages.
- Commit messages are short, one line (user preference). Do not run git commands on the user's behalf unless asked; give the message instead.

## Review Focus

1. A reply that is entirely quoted text (cleaning leaves nothing): save it with the body `(no new text)` instead of dropping it.
2. Sender formatted as `"Ada Smith" <Ada@Example.COM>`: still matches the lowercase application email.
3. The same email applied twice: the reply attaches to the most recent application.
4. A reply with only an HTML body: converted to readable text, not stored as tags.
5. Resend retrying the same event, including two arriving at once: exactly one row is stored (unique `providerMessageId`, unique-violation treated as duplicate).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `vitest.config.js` | Test runner config (new) |
| `app/services/email-text.server.js` | Pure helpers: `cleanEmailReply`, `htmlToText`, `parseEmailAddress`, `replySubject` (new) |
| `app/services/email-log.server.js` | `logEmail` writes an `EmailMessage` row, never throws (new) |
| `app/services/email-inbound.server.js` | `processInboundEmail`, the webhook's logic with injected dependencies (new) |
| `app/services/email-queries.server.js` | Thread list/thread/unmatched queries and pure `buildThreadList` (new) |
| `app/services/email.server.js` | Add `sendAndLog`, reply-to, `sendTradeReply`, `sendReplyCopy` (modify) |
| `app/routes/webhooks.resend.jsx` | Public webhook route (new) |
| `app/routes/app.emails.jsx` | Layout `<Outlet />` (new) |
| `app/routes/app.emails._index.jsx` | List page (new) |
| `app/routes/app.emails.$applicationId.jsx` | Thread page and reply action (new) |
| `app/routes/app.emails.unmatched.jsx` | Unmatched messages and assignment (new) |
| `app/routes/app.jsx` | Nav link (modify) |
| `app/routes/app.trade-applications.$id.jsx` | "Email trail" link (modify) |
| `prisma/schema.prisma` | `EmailMessage`, `EmailDirection`, relation (modify) |
| `tests/*.test.js` | Unit tests (new) |

---

### Task 1: Test runner and pure text helpers

**Files:**
- Create: `vitest.config.js`, `app/services/email-text.server.js`, `tests/email-text.test.js`
- Modify: `package.json` (devDependency `vitest`, script `"test": "vitest run"`)

**Interfaces:**
- Produces (`email-text.server.js`):
  - `cleanEmailReply(body: string): string` strips the quoted chain; returns `"(no new text)"` when nothing remains.
  - `htmlToText(html: string): string`
  - `parseEmailAddress(from: string): string` returns the lowercase address from `"Name" <a@b.com>` or bare `a@b.com`; `""` if none.
  - `replySubject(subject: string): string` prefixes `Re: ` unless already present (case-insensitive); empty subject becomes `Re: Your trade application`.

- [ ] **Step 1: Install and configure the runner.** `npm install -D vitest`, add the `test` script, and create `vitest.config.js` with `test: { environment: "node", include: ["tests/**/*.test.js"] }`.

- [ ] **Step 2: Write failing tests in `tests/email-text.test.js`**

```js
test("cleanEmailReply removes 'On ... wrote:' chain", ...)       // "Thanks!\n\nOn 13 Aug 2026, at 11:47, Urban Deco wrote:\n> hi" -> "Thanks!"
test("cleanEmailReply removes Original Message and > lines", ...)
test("cleanEmailReply removes Outlook From/Sent/To/Subject block", ...)
test("cleanEmailReply returns '(no new text)' when all quoted", ...)   // Review Focus 1
test("parseEmailAddress handles name, brackets and case", ...)   // '"Ada Smith" <Ada@Example.COM>' -> 'ada@example.com'  (Review Focus 2)
test("parseEmailAddress returns '' for garbage", ...)
test("htmlToText converts br/p/div to line breaks and strips tags and entities", ...)  // Review Focus 4
test("replySubject adds Re: once", ...)                           // 'Test' -> 'Re: Test'; 'RE: Test' unchanged
test("replySubject uses default for empty subject", ...)
```

- [ ] **Step 3: Run `npx vitest run tests/email-text.test.js`.** Expected: FAIL (module not found).

- [ ] **Step 4: Implement the four functions in `email-text.server.js`.** Port the regex steps of `cleanEmailReply` from `stoneage-enquiry-app/routes/webhooks.js:28-134`, then the `(no new text)` fallback. `htmlToText` is a small tag stripper with entity decoding for `&amp; &lt; &gt; &quot; &#39; &nbsp;`.

- [ ] **Step 5: Run `npx vitest run`.** Expected: PASS.

- [ ] **Step 6: Commit** — `test: add vitest and email text helpers`

---

### Task 2: EmailMessage schema, migration and logger

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_email_messages/migration.sql` (generated), `app/services/email-log.server.js`, `tests/email-log.test.js`

**Interfaces:**
- Produces: Prisma model `EmailMessage` per the spec table, enum `EmailDirection { OUTBOUND INBOUND }`, relation `TradeApplication.emailMessages EmailMessage[]` (`applicationId` optional, `onDelete: SetNull` so deleting an application keeps the message as unmatched).
- Produces: `logEmail(data: { applicationId?: string|null, direction: "OUTBOUND"|"INBOUND", kind: string, fromEmail: string, toEmail: string, subject: string, bodyText: string, providerMessageId: string }): Promise<{ ok: true, message } | { ok: false, duplicate?: boolean, error?: unknown }>` never throws; a unique violation (`error.code === "P2002"`) returns `{ ok: false, duplicate: true }`.
- Fields: `id` cuid, `providerMessageId` unique, `readAt DateTime?`, `createdAt DateTime @default(now())`, indexes on `applicationId`, `createdAt`, `readAt`.

- [ ] **Step 1: Write failing tests in `tests/email-log.test.js`** with `vi.mock("../app/db.server")` providing a fake `prisma.emailMessage.create`:

```js
test("logEmail returns ok with the created message", ...)
test("logEmail reports duplicate on P2002 without throwing", ...)   // Review Focus 5
test("logEmail swallows other errors and returns ok:false", ...)
```

- [ ] **Step 2: Run them.** Expected: FAIL (module not found).

- [ ] **Step 3: Edit `schema.prisma`** (model, enum, relation), then `npx prisma migrate dev --name add_email_messages` and `npx prisma generate`. Confirm the new migration folder exists and `npx prisma validate` passes.

- [ ] **Step 4: Implement `logEmail` in `email-log.server.js`** using `prisma.emailMessage.create`.

- [ ] **Step 5: Run `npx vitest run`.** Expected: PASS.

- [ ] **Step 6: Commit** — `feat: add EmailMessage model and logger`

---

### Task 3: Outbound sending, logging, reply-to, reply and copy

**Files:**
- Modify: `app/services/email.server.js`
- Test: `tests/email-send.test.js`

**Interfaces:**
- Consumes: `logEmail`, `htmlToText`, `replySubject`.
- Produces (all in `email.server.js`):
  - `sendAndLog({ application, kind, subject, html }): Promise<{ data, error }>` sends via Resend from `EMAIL_FROM` to `application.email` with `replyTo` = `EMAIL_REPLY_TO` (fallback address in `EMAIL_FROM`), then on success calls `logEmail` (`OUTBOUND`, `bodyText` = `htmlToText(html)`, `providerMessageId` = `data.id`). Same return shape as `resend.emails.send`.
  - `sendTradeReply({ application, subject, body }): Promise<{ success: boolean, error?: unknown }>` uses `replySubject`, wraps the body in a simple branded layout with escaped text and line breaks, sends through `sendAndLog` with `kind: "MANUAL_REPLY"` (log `bodyText` = the plain `body`).
  - `sendReplyCopy({ application, subject, body, threadUrl }): Promise<{ success: boolean, error?: unknown }>` sends from `EMAIL_FROM` to `REPLY_COPY_TO` (default `EMAIL_FROM` address) with `replyTo: application.email`, subject `Reply from <businessName>: <subject>`, escaped body, and the thread link. Not logged.
- Existing functions `sendTradeApprovalEmail`, `sendTradeRejectionEmail`, `sendApplicationReceivedEmail`: replace each `resend.emails.send({ from, to, subject, html })` call with `sendAndLog({ application, kind, subject, html })` (kinds `APPROVAL`, `REJECTION`, `APPLICATION_RECEIVED`), leaving the surrounding `{ data, error }` handling untouched. `sendNewApplicationTeamEmail` is unchanged.

- [ ] **Step 1: Write failing tests in `tests/email-send.test.js`** mocking `resend` (capture `emails.send` args) and `email-log.server`:

```js
test("sendAndLog sends with reply-to from EMAIL_REPLY_TO and logs OUTBOUND", ...)
test("sendAndLog falls back to the EMAIL_FROM address when EMAIL_REPLY_TO is unset", ...)
test("sendAndLog does not log when Resend returns an error", ...)
test("sendTradeReply prefixes Re:, escapes HTML in the body, logs MANUAL_REPLY with the plain body", ...)
test("sendReplyCopy goes to REPLY_COPY_TO, not the inbound address, with replyTo = applicant email", ...)
```

- [ ] **Step 2: Run `npx vitest run tests/email-send.test.js`.** Expected: FAIL.

- [ ] **Step 3: Implement the three functions and swap the three existing `resend.emails.send` calls.** Read env vars at call time so tests can set them.

- [ ] **Step 4: Run `npx vitest run`.** Expected: PASS.

- [ ] **Step 5: Commit** — `feat: log outbound applicant emails and add reply sending`

---

### Task 4: Inbound email processing service

**Files:**
- Create: `app/services/email-inbound.server.js`, `tests/email-inbound.test.js`

**Interfaces:**
- Consumes: `cleanEmailReply`, `htmlToText`, `parseEmailAddress`, `logEmail`, `sendReplyCopy`.
- Produces: `processInboundEmail({ event, resend, prisma, sendCopy = sendReplyCopy, log = logEmail }): Promise<{ status: "ignored" | "duplicate" | "saved" | "unmatched" }>`.
  - Not `email.received`: `ignored`.
  - Fetch with `resend.emails.receiving.get(event.data.email_id)`; fetch error: throw (route returns 500 so Resend retries).
  - Sender = `parseEmailAddress(event.data.from)`; application = most recent `prisma.tradeApplication.findFirst({ where: { email: sender }, orderBy: { createdAt: "desc" } })`.
  - Body = `cleanEmailReply(received.text || htmlToText(received.html || ""))`.
  - `log` with `INBOUND`, `APPLICANT_REPLY`, `applicationId` or null; `{ duplicate: true }` result gives `duplicate`.
  - If matched, call `sendCopy` with the cleaned body and `threadUrl` built from `SHOPIFY_APP_URL` + `/app/emails/<id>`; a copy failure is caught and logged, never thrown.

- [ ] **Step 1: Write failing tests** with fake `resend`, `prisma`, `sendCopy`, `log`:

```js
test("ignores events other than email.received", ...)
test("saves a matched reply against the application and sends the copy", ...)
test("matches when From is '\"Ada\" <ADA@Example.com>'", ...)                 // Review Focus 2
test("attaches to the most recent application when the email applied twice", ...)   // Review Focus 3
test("saves unmatched senders with applicationId null and sends no copy", ...)
test("treats a duplicate provider id as duplicate and sends no copy", ...)    // Review Focus 5
test("falls back to converted HTML when there is no text body", ...)          // Review Focus 4
test("stores '(no new text)' for a fully quoted reply", ...)                  // Review Focus 1
test("a copy failure does not throw and the reply stays saved", ...)
test("throws when the received email cannot be fetched", ...)
```

- [ ] **Step 2: Run `npx vitest run tests/email-inbound.test.js`.** Expected: FAIL.

- [ ] **Step 3: Implement `processInboundEmail`** as specified.

- [ ] **Step 4: Run `npx vitest run`.** Expected: PASS.

- [ ] **Step 5: Commit** — `feat: process inbound applicant replies`

---

### Task 5: Resend webhook route

**Files:**
- Create: `app/routes/webhooks.resend.jsx`, `tests/webhook-route.test.js`

**Interfaces:**
- Consumes: `processInboundEmail`.
- Produces: `action({ request })` for `POST /webhooks/resend`:
  - Read `await request.text()`; require `svix-id`, `svix-timestamp`, `svix-signature` else 400.
  - `resend.webhooks.verify({ payload, headers: { id, timestamp, signature }, webhookSecret: process.env.RESEND_WEBHOOK_SECRET })`; throwing means 400.
  - Call `processInboundEmail`; return `200` JSON `{ received: true, status }`; any thrown error returns 500.
  - `loader` returns 405 (route is POST only).
- Pattern reference: `stoneage-enquiry-app/routes/webhooks.js:143-208`.

- [ ] **Step 1: Write failing tests** mocking `resend` and `email-inbound.server`:

```js
test("returns 400 when signature headers are missing", ...)
test("returns 400 when verification throws", ...)
test("returns 200 and calls processInboundEmail for a verified event", ...)
test("returns 500 when processing throws", ...)
```

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement the route.** No `authenticate.admin`. Create one module-level `Resend` instance.

- [ ] **Step 4: Run `npx vitest run`.** Expected: PASS.

- [ ] **Step 5: Commit** — `feat: add Resend inbound webhook route`

---

### Task 6: Thread queries

**Files:**
- Create: `app/services/email-queries.server.js`, `tests/email-queries.test.js`

**Interfaces:**
- Produces:
  - `buildThreadList(applications: Array<{ id, firstName, lastName, businessName, email, emailMessages: Array<{ direction, bodyText, subject, createdAt, readAt }> }>, query?: string): Array<{ applicationId, applicantName, businessName, email, latest: { direction, snippet, subject, createdAt }, unreadCount: number }>` pure; drops applications without messages, sorts by latest message descending, filters by case-insensitive match on name, business name or email, snippet is the first 120 characters of the latest body.
  - `listThreads(query?: string)`: loads applications that have messages (with all their messages' small fields) and returns `buildThreadList(...)`.
  - `getThread(applicationId: string)`: application summary plus messages ordered oldest first, or `null`.
  - `markThreadRead(applicationId: string)`: sets `readAt = now` on that application's unread `INBOUND` messages.
  - `listUnmatched()`: messages with `applicationId` null, newest first.
  - `assignUnmatched(messageId: string, applicationId: string)`: sets `applicationId` on a message that is currently unmatched, and marks it unread-preserving (leaves `readAt` unchanged).

- [ ] **Step 1: Write failing tests for `buildThreadList` only** (the pure part; the Prisma helpers are verified in Task 7):

```js
test("drops applications without messages", ...)
test("sorts by latest message, newest first", ...)
test("counts unread inbound messages only", ...)
test("search matches name, business and email case-insensitively", ...)
test("snippet is trimmed to 120 characters", ...)
```

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement the module.**

- [ ] **Step 4: Run `npx vitest run`.** Expected: PASS.

- [ ] **Step 5: Commit** — `feat: add email thread queries`

---

### Task 7: Emails pages, nav and application link

**Files:**
- Create: `app/routes/app.emails.jsx`, `app/routes/app.emails._index.jsx`, `app/routes/app.emails.$applicationId.jsx`, `app/routes/app.emails.unmatched.jsx`
- Modify: `app/routes/app.jsx` (nav link `Emails` after Trade Applications), `app/routes/app.trade-applications.$id.jsx` ("Email trail" link to `/app/emails/<id>` near the existing header actions)

**Interfaces:**
- Consumes: `listThreads`, `getThread`, `markThreadRead`, `listUnmatched`, `assignUnmatched`, `sendTradeReply`.
- List page: loader reads `q` from the URL; renders the spec's table (applicant, latest snippet with `You:` prefix for outbound, relative date, unread dot), a search box, and an `Unmatched (n)` link. Empty state when there are no threads.
- Thread page: loader calls `getThread` (404 if null) then `markThreadRead`; shows header with applicant, a `View application` link, chronological messages with older ones collapsed behind an expand control (latest expanded), a reply form (subject prefilled from the latest subject via `replySubject`, textarea, Send button disabled while sending). Action `intent=reply` validates a non-empty body, calls `sendTradeReply`, returns `{ error }` or success; bodies rendered as escaped text with `white-space: pre-wrap`.
- Unmatched page: lists unmatched messages with a select of applications (name, business, email) and an Assign button posting `assignUnmatched`.
- All loaders and actions run behind the parent `app.jsx` auth; actions also call `authenticate.admin(request)` as in `app.trade-applications._index.jsx`.

- [ ] **Step 1: Create the four route files and the nav and application links** following the existing inline-style conventions of `app.trade-applications._index.jsx`.

- [ ] **Step 2: Run `npx eslint app/routes/app.emails*.jsx app/services/email-*.js` and `npx vitest run`.** Expected: no new lint errors (the existing `react/prop-types` warning style on small components may appear; add props validation or disable per the project's existing approach), tests PASS.

- [ ] **Step 3: Run `npm run build`.** Expected: build succeeds.

- [ ] **Step 4: Manual check with `npm run dev`.** Insert a test `EmailMessage` through Prisma Studio (`npx prisma studio`) for a real application, then confirm: it appears in the list with an unread dot, opening the thread clears the dot, a reply sends and appears in the thread, and an unmatched message can be assigned. Expected: all four behave as described.

- [ ] **Step 5: Commit** — `feat: add Emails list, thread and unmatched pages`

---

### Task 8: Environment and webhook go-live checklist

**Files:**
- Modify: `.env.example` if present, otherwise none (document the variables in the final hand-off)

**Interfaces:** none; this task is verification of the full flow after deployment.

- [ ] **Step 1: Add the new variables to the hosting environment and local `.env`:** `EMAIL_REPLY_TO=trade@reply.urbandeco.co.uk`, `RESEND_WEBHOOK_SECRET` (after step 3), optional `REPLY_COPY_TO`, and confirm `SHOPIFY_APP_URL` is already set.
- [ ] **Step 2: Deploy, run `npm run setup`** (generates the client and applies the migration).
- [ ] **Step 3: In Resend, add a webhook for incoming email** pointing at `<app url>/webhooks/resend`, copy the signing secret into `RESEND_WEBHOOK_SECRET`, and redeploy or restart.
- [ ] **Step 4: End-to-end test.** Submit a test trade application, reply to the "application received" email from the applicant address, and confirm: the reply appears in the app thread, a copy arrives in the `trade@` webmail inbox, and a reply sent from the app reaches the applicant from `trade@`. Expected: all three pass.
- [ ] **Step 5: Commit** — `docs: note email trail environment variables` (only if a file changed)
