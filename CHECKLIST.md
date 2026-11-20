# Nyaris Popup implementation checklist

Initial inspection, before implementation. Numbers refer to the supplied PRD.

| Requirement | Initial state |
|---|---|
| 1–2. Internal roles, one current event, reusable website | Shared demo identity and sample event |
| 3. One voucher, one tenant and method, manual confirmation, stamp after save | Implemented for demo |
| 4. Private login, assigned staff, role enforcement and exports | Missing |
| 5. Event schedule, override, closure and history | Missing |
| 6. Exclusive session, ownership, recovery, handover and reports | Partial, shared local session |
| 7. Additive amounts, QRIS/Cash, duplicate suppression and failed-save recovery | Partial, demo only |
| 8. Same-day corrections, cancellations, actor and before/after audit | Missing |
| 9. Live gross, method, tenant, cashier and session reports | Partial demo summaries |
| 10. Private percentage, gross/share/net and audit | Missing |
| 11. Durable one-way Sheets updates, separate files, retries and status | Missing; credentials and destinations unknown |
| 12. Persistent relational records, password protection and integrity | SQLite preview only |
| 13. Acceptance cases 1–16 | Partial smoke test only |
| 14. Deferred items | Outside v1 |
| 15–16. Open decisions and earlier handoff | Current build request governs; record implementation defaults below |

## Implementation and verification after build

| PRD section | Delivered behavior and verification |
|---|---|
| 1–3 | Internal cashier workspace with no public signup, tenant or buyer portal. One voucher maps to one tenant, method, amount and saved ID. Manual QRIS/Cash confirmation precedes the stamp message. Automatic QR verification and physical duplicate detection remain outside scope. |
| 4 | Database-backed, username/password login and logout. Developer creates/disables accounts, resets passwords and assigns staff. Server rechecks current account, role and assignment on requests. Root page and APIs enforce login. Tests exercise unauthorized, cashier and developer requests. |
| 5 | Developer creates and schedules events, chooses the current event, and switches scheduled/manual active/manual inactive modes. Event history is selectable. Closure blocks recording while same-day corrections remain available. |
| 6 | Exclusive active session per event enforced inside a database transaction with a unique index. Browser close preserves it. Owner-only session ending; developer recovery requires a reason and is audited. Session totals and duration are computed from saved rows. Concurrent-start test admits one cashier. |
| 7 | Manual rupiah entry, additive +5,000/+10,000, QRIS default, manual receipt confirmation, server validation, idempotent payment IDs and commit-before-reset. A failed request keeps the form open. |
| 8 | Correct tenant/amount/method or cancel a paid sale, with mandatory reason, original attribution, before/after snapshots, actor, timestamp and optimistic version check. Cashier cutoff is the original transaction's WIB date. Developer can correct older dates. Cancelled rows are immutable. |
| 9 | Two-second polling for independent signed-in viewers. Paid total/count, QRIS/Cash, tenant and cashier totals, session detail/duration, date, status and synchronization state. History filters cover tenant, cashier, payment method and status. |
| 10 | Event-wide percentage, audited changes, and private per-tenant gross/share/net report. Cashier projections omit private data and the private spreadsheet ID. Tested Rp1,000,000 at 15%. |
| 11 | Implemented per-event operational and private spreadsheet destinations, durable revisions, permission checks, atomic full-tab refresh, status and retry. Worker starts with the site. Local retry and output-separation checks pass. **Live OAuth, Drive access, remote writes and actual sharing remain unverified.** |
| 12 | SQLite WAL persistent storage, relational keys, transactional updates, salted password hashes, hashed authentication tokens. Test data runs separately. |
| 13 | Acceptance checks below. |
| 14 | Deferred items remain excluded, including inventory, combined vouchers, buyer accounts, auto refunds and offline payment capture. |
| 15–16 | Defaults used for this build appear below. Deployment, Google ownership/credentials and final design sign-off remain owner decisions. |

### Acceptance checks

| PRD check | Result |
|---|---|
| 1–2. Login before event activation; automatic schedule and manual modes | Local HTTP tests cover future schedule, active schedule, manual on/off and return to automatic. |
| 3–4. Concurrent start and ownership | Passed concurrent requests and cross-cashier sale rejection. |
| 5–6. Amounts, QRIS, cash, event and originating session | Positive integer checks, invalid amounts and both methods exercised against the server. |
| 7–8. Retries and failure | Repeated sale ID produced one row. Rejected writes return errors. UI reset follows only successful responses. |
| 9–11. Today, cancellation and older records | Tested correcting another cashier's ended-session sale after closure, stale version rejection, cancellation, prior-day denial and developer override. |
| 12. Reporting | Separate authenticated reads reflect committed rows. Client polls every two seconds; cancelled sales are excluded. |
| 13–14. Sharing calculation and privacy | Rp150,000 share/Rp850,000 net verified. Cashier API and operational report projection checked for private values. |
| 15. Sheets | Local durable failure and retry verified; real Google end-to-end check pending credentials. |
| 16. Closure | Recording after session closure rejected; permitted corrections after event closure passed. |

### Working defaults

- One current event per installation. Developer selects it; its schedule controls opening/closing. Manual override persists until changed. A developer may operate their own session. Historical events remain accessible to assigned cashiers.
- One event-wide percentage, 0–100 with two decimal places. Round the organizer share to the nearest whole rupiah per tenant, half up. Tenant receives the remaining gross. No fee deduction or disbursement tracking.
- Cashiers may see activity for other staff in the assigned event. All day boundaries use Asia/Jakarta. There is no reinstatement of cancelled sales.
- After unexpected closure, preserve the draft in the open screen and block submission. A developer must review the paper voucher before reopening the event. Verify the existing transaction history before re-entering a payment received near closure.
- Dedicated owner-managed Google files per event. Spreadsheet sharing changes are manual. No separate downloadable CSV/XLSX option has been added.
