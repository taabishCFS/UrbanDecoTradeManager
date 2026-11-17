import { cleanEmailReply, htmlToText } from "./email-text.server.js";

/* ============================================================
   BUILD AN EmailMessage ROW FROM A PARSED MAILBOX MESSAGE

   Pure function used by scripts/import-old-emails.js (explicit
   .js import so plain Node can load it too).

   `parsed` is a mailparser result. `applicants` maps a lowercase
   applicant email to the id of their most recent application.

   Returns a row for prisma.emailMessage, or null when the message
   should be skipped (no Message-ID, no applicant involved, or the
   app's own reply copies sent from trade@ to trade@).
============================================================ */

function addressesOf(field) {
  return (field?.value || [])
    .map((entry) => (entry.address || "").trim().toLowerCase())
    .filter(Boolean);
}

export function buildImportRow({ parsed, ownAddress, applicants }) {
  if (!parsed?.messageId) return null;

  const own = ownAddress.toLowerCase();
  const from = addressesOf(parsed.from)[0] || "";
  const recipients = [...addressesOf(parsed.to), ...addressesOf(parsed.cc)];

  const outbound = from === own;

  const applicantEmail = outbound
    ? recipients.find((address) => applicants.has(address))
    : applicants.has(from)
      ? from
      : undefined;

  if (!applicantEmail) return null;

  const body = cleanEmailReply(
    parsed.text?.trim() ? parsed.text : htmlToText(parsed.html || "")
  );

  return {
    applicationId: applicants.get(applicantEmail),
    direction: outbound ? "OUTBOUND" : "INBOUND",
    kind: "IMPORTED",
    fromEmail: from,
    toEmail: outbound ? applicantEmail : recipients[0] || own,
    subject: parsed.subject || "",
    bodyText: body,
    providerMessageId: `imap:${parsed.messageId}`,
    createdAt: parsed.date instanceof Date ? parsed.date : new Date(),
    // Imported replies are history, so they should not show as unread.
    readAt: outbound ? null : new Date(),
  };
}
