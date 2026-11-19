# Trade Orders and Proforma Invoices: Design

Date: 2026-11-18
Status: draft, awaiting approval

## Intent and why

Trade clients often order outside the storefront and pay by bank transfer, or pay through a link the team sends. Today the team has no place in the app to raise an order for a trade account, and no view of what trade accounts have ordered. Add an **Orders** area to the embedded app where the merchant can:

- create an order on behalf of a trade account, starting as a **proforma invoice** (PDF) the client can pay against,
- when payment is received, turn it into a real Shopify order and generate the **final invoice**, which carries the real Shopify order number,
- see the orders trade accounts placed themselves.

## Goals

- Orders page with two tabs: **Proformas** (drafts we created, status Draft / Sent / Paid / Cancelled) and **Trade orders** (orders placed by trade accounts, read from Shopify).
- Create-proforma form: pick a trade account, add products with the Shopify product picker, set quantities, an order-level discount percent (prefilled from the account's `discountPercent`, editable) and an optional per-line discount percent, optional custom shipping/delivery line (label and price, £0 allowed), notes, and the proforma header fields from the sample: PO number, project reference, payment terms (default "Before dispatch"), delivery address, delivery window.
- App creates a Shopify draft order for the account's `shopifyCustomerId`, and stores a local `Proforma` record with its own number (`PF-0001`, sequential).
- Proforma PDF generated and emailed to the trade account (via the existing email service) also a download button to download the invoice, with the draft's Shopify checkout link (`invoiceUrl`) included so the client can pay by card, or the bank details so they can pay by transfer.
- Two payment paths, both ending in the same state:
  - Checkout link: client pays, Shopify completes the draft into an order. The app detects this and marks the proforma Paid.
  - Bank transfer: staff click **Mark as paid**. The app completes the draft as paid (`draftOrderComplete`, payment not pending).
- On Paid: store the Shopify order id and number on the proforma, generate the final invoice PDF (invoice number from the Shopify order number), email it to the client, show both PDFs on the proforma detail page.
- Every proforma has an "Open in Shopify" link to the draft order for anything unusual.

## Non-goals (version 1)

- Editing a sent proforma in the app (staff cancel and recreate, or edit in Shopify and re-sync).
- Partial payments, deposits, credit notes, refunds through the app.
- Multi-currency. Store currency only.
- Reading orders older than 60 days, unless `read_all_orders` is approved (see constraints).
- Customer-facing portal for proformas.

## Anti-goals

- A proforma must never be mistaken for a tax invoice: the PDF says PROFORMA and "not a tax invoice" and uses the `PF-` number, never an order number.
- The same payment must never create two orders or two final invoices (completion and invoice generation are idempotent).
- Trade pricing must never be silently lost: draft orders do not receive automatic discounts, so the discount is applied explicitly and shown on the PDF.

## Constraints

- Current scopes are `write_products, write_metaobjects, write_metaobject_definitions, write_app_proxy, write_customers, read_orders, write_discounts`. Needed in addition: `write_draft_orders` (and `read_draft_orders` is implied by write). Adding scopes requires merchant re-approval on deploy.
- `read_orders` only returns the last 60 days. Full history needs `read_all_orders`, which Shopify must approve. The Trade orders tab ships with the 60-day limit and states it.
- Existing `orders/create` webhook creates commissions keyed by `shopifyOrderId` (unique upsert), so orders completed from our drafts will pass through it. Commission handling for staff-created orders must be decided (see open questions).
- Deployed on Render with a Postgres DB through Prisma. No headless browser available, so the PDF library must be pure Node.
- Email goes through Resend (`resend` package already in use, supports attachments).

## Approaches considered

- **A. Redirect to Shopify's draft order page.** App only tracks drafts. Cheapest, but the app can't reliably tie a draft to a trade account or apply its pricing, and staff leave the app. Rejected.
- **B. Simple in-app form (chosen).** Staff stay in the app, trade pricing is applied from the account, proforma and invoice numbering and PDFs are ours, with an Open-in-Shopify escape hatch.
- **C. B plus a "create in Shopify instead" path.** Covered by B's Open-in-Shopify link, so not a separate build.

The merchant chose B.

## Design

### Data

New Prisma model `Proforma`:

- `id`, `number` (unique, `PF-0001` style, generated from a DB sequence/counter row to avoid races),
- `tradeAccountId` (relation),
- `shopifyDraftOrderId` (unique), `shopifyOrderId?` (unique), `shopifyOrderNumber?`,
- `status`: `DRAFT | SENT | PAID | CANCELLED`,
- `paymentMethod?`: `CHECKOUT_LINK | BANK_TRANSFER`,
- `currency`, `subtotal`, `discountTotal`, `shipping`, `tax`, `total` (snapshotted decimals),
- `lineItems` (JSON snapshot used to render PDFs, so PDFs don't change if the product changes),
- `poNumber?`, `projectReference?`, `paymentTerms`, `deliveryAddress?`, `deliveryWindow?`, `includePaymentLink` (default false),
- `notes?`, `invoiceUrl?`,
- `proformaPdf?`, `invoicePdf?` (stored bytes or regenerated on demand, builder's call),
- `sentAt?`, `paidAt?`, `createdAt`, `updatedAt`.

### Shopify

- Create: `draftOrderCreate` with `purchasingEntity.customerId`, line items (variant id, quantity, `appliedDiscount` per line), order-level `appliedDiscount`, optional shipping line, `note`, tag `trade-proforma`, custom attribute `proformaNumber`.
- Send link: use the draft's `invoiceUrl`; do not use Shopify's own invoice email (we send ours).
- Complete (bank transfer): `draftOrderComplete(paymentPending: false)`.
- Detect completion for the checkout-link path: subscribe to `draft_orders/update`; when the draft status is `completed`, look up the proforma by `shopifyDraftOrderId`, store the order id and number, mark Paid if the order is paid. Fall back to matching in `orders/create` by the proforma attribute.
- Trade orders tab: Admin GraphQL `orders` query filtered to customers with a `shopifyCustomerId` in `TradeAccount`, excluding orders that came from our proformas (so they don't appear twice).

### Pages (React Router, Polaris, matching existing routes)

- `app.orders.jsx` layout and `app.orders._index.jsx` with the two tabs.
- `app.orders.new.jsx`: create form.
- `app.orders.$id.jsx`: proforma detail with status, PDFs, Send / Resend, Mark as paid, Cancel, Open in Shopify.
- Add **Orders** to the nav and a link from the trade account detail page.

### PDFs and email

- `pdfkit` (pure Node) in a new `invoice-pdf.server.js`: one layout, two modes (proforma, invoice), modelled on the merchant's sample (`Urban Deco Pro Forma Invoice PO3967 E164.pdf`, one A4 page):
  - Header: Urban Deco logo (needs the logo file added to the repo), title "PRO FORMA INVOICE" or "INVOICE", date.
  - FROM block: Urban Deco, Unit 1, 15 Bakewell Road, Loughborough, England, LE11 5QY, VAT Registration GB433397583, hello@urbandeco.co.uk, Tel 0116 296 2565. Kept in one config module, not hardcoded in the layout.
  - BILL TO block from the trade account's application: business name, "trading as" line when the business is a trading name, address, and "Customer VAT:" from `vatNumber` when present.
  - Grey info panel: PO number, project reference, payment terms (default "Before dispatch"), delivery address, delivery window. Blank fields are omitted.
  - Line table: description (product title bold, variant title, optional dimensions line), qty, unit price ex VAT, net. A delivery line (shown even at £0.00, e.g. "Free doorstep delivery to <postcode>"). Then Subtotal, VAT (20%), TOTAL DUE.
  - BANK TRANSFER DETAILS (proforma only): account name `TDC OF LEICESTER LTD`, Barclays Bank, sort code 20-49-17, account number 70211826, and payment reference `PO <po> / <project ref>` (falls back to the proforma number when neither is entered). Kept in config.
  - NOTES: "Payment is required before dispatch.", "Please use <reference> as your bank payment reference.", "An order number will be provided after payment has been received." Delivery wording is added from the delivery line. Staff can add free-text notes.
  - Footer: `URBAN DECO | 0116 296 2565 | hello@urbandeco.co.uk | VAT GB433397583` and page number.
  - The final invoice uses the same layout with the real Shopify order number shown, a "PAID" marker and the paid date, and without bank details or the "order number will be provided" note.
  - Layout care: the sample has a divider line crossing the last bank-detail row ("Payment reference"); the new layout must leave space so no row is overlapped.
  - Card payment link: the sample is bank-transfer only. The checkout link is only included when staff tick "include card payment link" on the proforma (default off).
- `proforma-email.server.js` using the existing branded layout and `sendAndLog`-style helpers, with the PDF attached. Logged so it appears in the account's email trail where applicable.

### Safety

- Completion and invoice generation are idempotent: a status check inside a transaction, and unique constraints on `shopifyOrderId` and the proforma number.
- Cancel deletes or closes the Shopify draft and sets status Cancelled; a Paid proforma cannot be cancelled.

## What's left to the builder

- PDF storage (bytes in DB vs regenerate on demand), invoice number format for the final invoice, exact PDF styling, how bank details and business address are configured (env vars vs settings), and the order of the build (data and Shopify calls first, then pages, then PDFs and email).

## Open questions for the merchant

1. **Commission on staff-created orders. Answered by the merchant:** the existing `orders/create` rules apply unchanged. Referral and client-special-price accounts earn commission on staff-created orders; trade-price accounts earn none. No code change to commission logic is needed beyond confirming draft-completed orders flow through it.
2. **Bank details and company/VAT details:** answered by the sample proforma (see PDFs and email). Account name on the sample is `TDC OF LEICESTER LTD`, different from the trading name Urban Deco; copied as shown.
3. **Proforma validity:** the sample shows none, so none is printed and there is no automatic expiry. Payment terms default to "Before dispatch".
4. **VAT and pricing. Resolved by checking the store.** Shopify has `taxesIncluded: false` and recent orders (UD3124 to UD3126) have zero tax lines, but customers pay the displayed price, which in practice includes VAT (storefront £889.99 less 15% = £756.50, which is the sample's total). So Shopify neither adds nor records VAT, and draft orders will charge exactly the discounted displayed price.
   - The app computes VAT itself for the PDF only: ex-VAT = inclusive / 1.2, VAT = inclusive − ex-VAT, 2dp rounding. Check: 756.50 / 1.2 = 630.42, VAT 126.08.
   - The draft order total (what the customer pays) stays the inclusive figure, so the PDF's TOTAL DUE always equals the Shopify draft total. The PDF's ex-VAT unit price, net, subtotal and VAT lines are derived from it.
   - The VAT rate (20%) lives in config.
   - Discounts apply to the inclusive price, as the storefront does.
   - Any bank-transfer total must be rounded to pence the same way Shopify rounds it, so what is paid matches the order.

## Resolved details from the store

- **Dimensions:** product metafield `custom.dimension_1` (multi-line text, e.g. `W 115cm x D 43cm x H 81cm`). Printed as the third description line when present.
- **Description lines:** the product title is split at the first " - ": the part before is the bold name ("Tobago Curved Sideboard"), the rest plus the variant title is the second line ("2 Door - Small - Espresso Oak / Brown"), as in the sample.
- **Final invoice number:** Shopify order names look like `UD3126`, so the final invoice uses that real order name as its number.
