# Import old trade emails (one-time, last 2 months)

This copies the last 2 months of applicant emails from the `trade@urbandeco.co.uk` mailbox into the app, so old conversations show on the Emails page. Run it once from your PC.

## Before you start

1. **Which database?** The script writes to the database in your local `.env` (`DATABASE_URL`). Open `.env` and check it is your **live Supabase** database, not a local test one. If it is a pooled Supabase URL (port 6543) that is fine for this script.
2. **Get the IMAP host.** In cPanel open **Email, then Email Accounts, then Connect Devices** for `trade@`. Note the **incoming server** (often `mail.urbandeco.co.uk`). The port is 993.
3. **Have the `trade@` mailbox password ready.** You will type it into the terminal for this run only. Do not save it in `.env` and do not paste it in chat.

## Step 1: Dry run (writes nothing)

Open PowerShell in the project folder and run:

```powershell
$env:IMAP_HOST = "mail.urbandeco.co.uk"
$env:IMAP_PASSWORD = "the-trade-mailbox-password"
node --env-file=.env scripts/import-old-emails.js
```

It prints something like:

```
DRY RUN: trade@urbandeco.co.uk, last 2 month(s) since 2026-09-17
Known applicant emails: 14
Folder INBOX: 220 message(s) in range
Folder INBOX.Sent: 95 message(s) in range

Scanned 315 message(s): 41 to import, 274 skipped (not applicant mail).
Applicants with emails: 9
  2026-10-20 INBOUND  ada@example.com -> trade@urbandeco.co.uk | Re: Your application
  ...
Dry run only: nothing was written. Re-run with --commit to import.
```

Check that the numbers look sensible and the sample lines are real applicant emails.

## Step 2: Import for real

Same command with `--commit`:

```powershell
node --env-file=.env scripts/import-old-emails.js --commit
```

It prints `Imported N new message(s)`. Running it again is safe: already-imported emails are skipped, so nothing is duplicated.

## Step 3: Clean up and check

1. Clear the password from the terminal session:
   ```powershell
   Remove-Item Env:IMAP_PASSWORD
   ```
2. Open the app, go to **Emails**, and open an applicant. Old emails should appear in date order. Imported replies are marked as already read.

## Options

- **Different time range:** add `--months=3` (default is 2).
- **Different mailbox user:** set `$env:IMAP_USER` (default is `trade@urbandeco.co.uk`).

## What it will and will not bring in

- **Brought in:** emails from applicants to `trade@`, and emails the team sent to applicants from webmail, for applicants whose email address matches a trade application.
- **Not brought in:** emails the app sent itself through Resend (received, approval, rejection), because they were never saved in the mailbox. Mail from people who are not applicants is ignored and never stored.
- **Not matched:** an applicant who wrote from a different address than the one on their application is skipped.

## If it fails

- `Set IMAP_HOST and IMAP_PASSWORD`: you did not set the variables in the same PowerShell window.
- `Invalid credentials` or `Authentication failed`: wrong password or username. Try logging in to webmail with the same password.
- Connection timeout or `ECONNREFUSED`: the host name or port is wrong, or your network blocks port 993. Try another network.
- `Environment variable not found: DATABASE_URL`: run from the project folder so `--env-file=.env` finds `.env`.
