/* eslint-disable no-undef */
import { Resend } from "resend";

import prisma from "../db.server";
import { sendReplyCopy } from "../services/email.server";
import { logEmail } from "../services/email-log.server";
import { processInboundEmail } from "../services/email-inbound.server";

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Public Resend webhook for received (applicant reply) emails.
 * Lives outside /app, so no Shopify admin session is involved;
 * the request is authenticated by the Resend signature instead.
 */

export async function loader() {
  return Response.json({ error: "Method not allowed." }, { status: 405 });
}

export async function action({ request }) {
  const payload = await request.text();

  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");

  if (!id || !timestamp || !signature) {
    return Response.json(
      { error: "Missing webhook signature." },
      { status: 400 }
    );
  }

  let event;

  try {
    event = resend.webhooks.verify({
      payload,
      headers: { id, timestamp, signature },
      webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
    });
  } catch (error) {
    console.error("RESEND WEBHOOK VERIFICATION FAILED:", error);

    return Response.json(
      { error: "Invalid webhook signature." },
      { status: 400 }
    );
  }

  try {
    const result = await processInboundEmail({
      event,
      resend,
      prisma,
      sendCopy: sendReplyCopy,
      log: logEmail,
    });

    return Response.json({ received: true, status: result.status });
  } catch (error) {
    console.error("RESEND WEBHOOK PROCESSING FAILED:", error);

    return Response.json(
      { error: "Webhook processing failed." },
      { status: 500 }
    );
  }
}
