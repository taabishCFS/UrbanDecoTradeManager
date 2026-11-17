/* eslint-disable no-undef */
/**
 * ONE-TIME IMPORT OF OLD TRADE EMAILS FROM THE trade@ MAILBOX
 *
 * Reads the last N months of the INBOX and Sent folders over IMAP,
 * keeps only mail to or from known trade applicants, and saves it to
 * the EmailMessage table so old conversations show in the Emails page.
 *
 * Safe by default: it only PRINTS what it would import (dry run).
 * Add --commit to actually write. Running it twice never creates
 * duplicates (each message is stored under its Message-ID).
 *
 * Usage (see docs/import-old-emails.md for the full guide):
 *   node --env-file=.env scripts/import-old-emails.js
 *   node --env-file=.env scripts/import-old-emails.js --commit
 *
 * Environment:
 *   IMAP_HOST       e.g. mail.urbandeco.co.uk
 *   IMAP_PORT       default 993
 *   IMAP_USER       default trade@urbandeco.co.uk
 *   IMAP_PASSWORD   the mailbox password (set only for this run)
 *   DATABASE_URL    from .env
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { PrismaClient } from "@prisma/client";

import { buildImportRow } from "../app/services/email-import.server.js";

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const monthsArg = args.find((arg) => arg.startsWith("--months="));
const months = monthsArg ? Number(monthsArg.split("=")[1]) : 2;

const host = process.env.IMAP_HOST;
const port = Number(process.env.IMAP_PORT || 993);
const user = process.env.IMAP_USER || "trade@urbandeco.co.uk";
const pass = process.env.IMAP_PASSWORD;

if (!host || !pass) {
  console.error("Set IMAP_HOST and IMAP_PASSWORD before running.");
  process.exit(1);
}

if (!Number.isFinite(months) || months <= 0) {
  console.error("--months must be a positive number.");
  process.exit(1);
}

const since = new Date();
since.setMonth(since.getMonth() - months);

const prisma = new PrismaClient();

async function loadApplicants() {
  const applications = await prisma.tradeApplication.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true },
  });

  // Newest application wins when the same email applied more than once.
  const map = new Map();
  for (const application of applications) {
    const email = application.email.trim().toLowerCase();
    if (!map.has(email)) map.set(email, application.id);
  }

  return map;
}

async function foldersToRead(client) {
  const mailboxes = await client.list();

  const sent = mailboxes.find(
    (box) => box.specialUse === "\\Sent" || /^(inbox\.)?sent( items| mail)?$/i.test(box.path)
  );

  return ["INBOX", ...(sent ? [sent.path] : [])];
}

async function main() {
  console.log(
    `${commit ? "IMPORTING" : "DRY RUN"}: ${user}, last ${months} month(s) since ${since.toISOString().slice(0, 10)}`
  );

  const applicants = await loadApplicants();
  console.log(`Known applicant emails: ${applicants.size}`);

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  await client.connect();

  const rows = [];
  let scanned = 0;
  let skipped = 0;

  try {
    for (const folder of await foldersToRead(client)) {
      const lock = await client.getMailboxLock(folder);

      try {
        const uids = await client.search({ since }, { uid: true });

        console.log(`Folder ${folder}: ${uids ? uids.length : 0} message(s) in range`);

        if (!uids || uids.length === 0) continue;

        for await (const message of client.fetch(
          uids,
          { source: true, uid: true },
          { uid: true }
        )) {
          scanned += 1;

          const parsed = await simpleParser(message.source);
          const row = buildImportRow({
            parsed,
            ownAddress: user,
            applicants,
          });

          if (row) rows.push(row);
          else skipped += 1;
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout();
  }

  // The same message can appear in both folders (or twice in one).
  const unique = [...new Map(rows.map((row) => [row.providerMessageId, row])).values()];

  const perApplication = new Map();
  for (const row of unique) {
    const entry = perApplication.get(row.applicationId) || { in: 0, out: 0 };
    if (row.direction === "INBOUND") entry.in += 1;
    else entry.out += 1;
    perApplication.set(row.applicationId, entry);
  }

  console.log("");
  console.log(`Scanned ${scanned} message(s): ${unique.length} to import, ${skipped} skipped (not applicant mail).`);
  console.log(`Applicants with emails: ${perApplication.size}`);

  for (const row of unique.slice(0, 10)) {
    console.log(
      `  ${row.createdAt.toISOString().slice(0, 10)} ${row.direction.padEnd(8)} ${row.fromEmail} -> ${row.toEmail} | ${row.subject.slice(0, 60)}`
    );
  }

  if (unique.length > 10) console.log(`  ... and ${unique.length - 10} more`);

  if (!commit) {
    console.log("");
    console.log("Dry run only: nothing was written. Re-run with --commit to import.");
    return;
  }

  const result = await prisma.emailMessage.createMany({
    data: unique,
    skipDuplicates: true,
  });

  console.log("");
  console.log(`Imported ${result.count} new message(s). ${unique.length - result.count} already existed.`);
}

main()
  .catch((error) => {
    console.error("IMPORT FAILED:", error.message);

    // imapflow hides the useful detail behind "Command failed".
    if (error.responseText) console.error("Server said:", error.responseText);
    if (error.serverResponseCode) console.error("Server code:", error.serverResponseCode);
    if (error.code) console.error("Error code:", error.code);

    if (error.authenticationFailed) {
      console.error(
        "Login was rejected. Check the password, and try IMAP_USER set to the full address (trade@urbandeco.co.uk) or just the part before the @ (trade)."
      );
    }

    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
