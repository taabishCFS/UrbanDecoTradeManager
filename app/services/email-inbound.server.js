import {
  cleanEmailReply,
  htmlToText,
  parseEmailAddress,
} from "./email-text.server";

/* ============================================================
   PROCESS AN INBOUND (APPLICANT REPLY) EMAIL EVENT

   All side-effecting dependencies are injected by the webhook
   route (resend client, prisma, log, sendCopy) so this module
   has no import-time side effects and is easy to test.

   Returns { status: "ignored" | "duplicate" | "saved" | "unmatched" }.
   Throws when the email cannot be fetched or saved, so the
   webhook answers 500 and Resend retries.
============================================================ */

export async function processInboundEmail({
  event,
  resend,
  prisma,
  sendCopy,
  log,
}) {
  if (event?.type !== "email.received") {
    return { status: "ignored" };
  }

  const emailData = event.data;

  const { data: received, error } = await resend.emails.receiving.get(
    emailData.email_id
  );

  if (error || !received) {
    throw new Error("Unable to retrieve received email.");
  }

  const sender = parseEmailAddress(emailData.from);
  const subject = emailData.subject || "";

  const application = sender
    ? await prisma.tradeApplication.findFirst({
        where: { email: sender },
        orderBy: { createdAt: "desc" },
      })
    : null;

  const body = cleanEmailReply(
    received.text?.trim() ? received.text : htmlToText(received.html || "")
  );

  const saved = await log({
    applicationId: application?.id ?? null,
    direction: "INBOUND",
    kind: "APPLICANT_REPLY",
    fromEmail: sender || String(emailData.from || ""),
    toEmail: Array.isArray(emailData.to)
      ? emailData.to.join(", ")
      : String(emailData.to || ""),
    subject,
    bodyText: body,
    providerMessageId: emailData.email_id,
  });

  if (saved.duplicate) {
    return { status: "duplicate" };
  }

  if (!saved.ok) {
    throw new Error("Unable to save received email.");
  }

  if (!application) {
    return { status: "unmatched" };
  }

  try {
    const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");

    await sendCopy({
      application,
      subject,
      body,
      threadUrl: appUrl ? `${appUrl}/app/emails/${application.id}` : "",
    });
  } catch (copyError) {
    console.error("REPLY COPY FAILED (reply is saved):", copyError);
  }

  return { status: "saved" };
}
