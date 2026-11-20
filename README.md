# Nyaris Popup POS

Internal, Indonesian-language cashier application for one current market event. Built with React, Next.js, TypeScript, and Node's SQLite driver.

## Run locally

Use Node 22.13 or newer and npm. This checkout already has a local owner. On a fresh installation:

1. Run `npm install` and `npm run owner -- owner`. The owner command runs only from the terminal, generates a random password, and displays it once. Store it in a password manager.
2. Run `npm run build`, then `npm start -- -H 127.0.0.1 -p 3430`. Both the web server and the automatic sync worker start together.
3. Open http://127.0.0.1:3430 and sign in. Under **Kelola**, create the event, its tenants and staff accounts. Assign cashiers to the event. The first event becomes current. Set its WIB schedule or explicitly activate it.
4. Staff sign in at the cashier page, start a session and enter vouchers. Closing a browser preserves the session. Logout ends the login only. A developer can close an abandoned cashier session with a reason.
5. Use **Transaksi** for corrections and cancellations, **Ringkasan** for paid totals, and **Sesi Kasir** for per-session totals. A cancellation records an accounting correction. Refund the buyer manually if necessary.

## Storage and deployment

Run one long-lived Node application with one worker on persistent disk. Keep the database and backups outside web-accessible directories. The default file is `data/nyaris.sqlite`. Set `POS_DATA_DIR` to change it. Set the same environment variable for owner provisioning. Stop the server before copying the database directory for a filesystem backup, or use SQLite's online backup. Restore on a separate host and verify before using a backup at an event.

Use HTTPS with `POS_HTTPS=1` for a network deployment. The local server uses HTTP on loopback. Sessions use opaque random tokens in HttpOnly cookies, a seven-day expiry, and token hashes in SQLite. Resetting or disabling a cashier account revokes its existing login tokens. The previous demo database remains separate. No demo tenants, sales or sessions are imported into event reports.

## Connect Google Sheets

**Current local status: unconnected.** No real Google credentials or report destinations were supplied.

1. Enable the Google Sheets API and Google Drive API in your Google Cloud project. Create a service account. Store its JSON key outside the web root and source archive. Restrict access to the server's account.
2. Copy `.env.example` to `.env.local`. Set `GOOGLE_APPLICATION_CREDENTIALS` to the absolute key-file path and `POS_GOOGLE_OWNER` to the email of the Google account owning both files. Restart the application.
3. For each event, create two dedicated, initially empty spreadsheets in that owner's My Drive. Give the service account Editor on both. Keep general access Restricted. Share only the operational spreadsheet with the assigned cashiers, preferably Viewer. Enter each cashier's Google email under **Kelola → Akun kasir**. Manage and revoke the actual Drive shares when staff assignments change.
4. Under **Kelola → Google Sheets**, bind the two spreadsheet IDs to their matching report types. The ID comes from the spreadsheet URL between /d/ and /edit. A destination can be corrected until its first successful sync. Previously selected files remain reserved for the same event and report type.
5. Verify a successful sync timestamp for both destinations. On a test event, record, correct, and cancel a test sale. Check the same transaction ID and the totals in the operational file. Change the developer percentage and check the private file. Sign in with a cashier's Google account to verify the private file is inaccessible.

The worker checks for durable pending revisions every five seconds and retries failed deliveries after a minute. Google calls happen outside payment commits. Each delivery checks the file owner and permissions, then atomically refreshes dedicated report tabs. Transaction order follows immutable creation time and insertion order. Corrections replace the entry for the same stored ID. All strings use literal cell values. Failed or unauthorized delivery leaves the revision pending. Report tabs are projections from the database; direct edits can be overwritten. A stopped server pauses delivery until restart.

Google APIs used: [service-account authentication](https://developers.google.com/identity/protocols/oauth2/service-account) and [atomic spreadsheet updates](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate).

## Verification

Run `npm run build && npm test`. The acceptance script provisions an isolated temporary database, launches the actual production server on an ephemeral loopback port, and removes its test data on exit. The suite runs the delivery code against simulated Google responses and checks uncertain-payment recovery, corrected and cancelled receipts, and worker exclusivity. Live Google verification requires the setup above.

See CHECKLIST.md for PRD coverage, defaults and remaining operational checks.
