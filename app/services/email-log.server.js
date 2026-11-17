import prisma from "../db.server";

/**
 * Saves one EmailMessage row. Never throws: a logging failure must
 * not break sending or the webhook.
 *
 * Returns:
 *   { ok: true, message }
 *   { ok: false, duplicate: true }   (providerMessageId already stored)
 *   { ok: false, error }
 */
export async function logEmail(data) {
  try {
    const message = await prisma.emailMessage.create({ data });

    return { ok: true, message };
  } catch (error) {
    if (error?.code === "P2002") {
      return { ok: false, duplicate: true };
    }

    console.error("EMAIL LOG ERROR:", error);

    return { ok: false, error };
  }
}
