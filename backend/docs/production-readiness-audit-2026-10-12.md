# Flowlytiks integration production-readiness audit

Date: 12 October 2026. Verdict: **NOT READY for an unconditional production release.**

The user reports working manual feature checks. This audit independently reviewed source,
local configuration shape, actual development database constraints/indexes/migration state,
regression tests, dependency advisories and selected browser layouts. Production infrastructure,
Google Cloud consent configuration and production database state were not accessible.
Passing local checks is not a certification of those systems.

## Findings, ranked by severity

### High: automatic Meet credit could race an incentive payout (fixed)

Evidence: `backend/services/meetVerificationService.js:110` previously created a pending
incentive without honoring `FacultyExtraIncentiveOperationLock`. The payout controller
(`backend/controllers/facultyextraincentivecontrollers.js:380`) calculates an online transfer
amount, calls the provider, then re-reads pending entries in its settlement transaction.
A new credit between those steps could be settled without being included in the transfer.
Copy-entry edits and payouts already share a per-faculty accounting lease.

A focused mocked regression reproduced credit creation while that lease was active.
The finalizer now locks the Faculty acquisition barrier and accounting-lease row, checks
the lease, and defers credit with `INCENTIVE_BUSY`. The evidence remains persisted and
the worker releases only its own lease and retries. After the payout lease expires or
is released, normal verification can credit once. Existing cancellation, identity,
unique-conference, rate-snapshot and atomic class/entry checks remain unchanged.

This is verified with a service-level simulated race, not a real Cashfree transfer or
a simultaneous PostgreSQL payout test. No calculation formula or payout status rule changed.

### High: Google publication/privacy prerequisites are not established (unresolved)

`backend/services/facultyGoogleService.js:5` requests exactly `openid` plus
`https://www.googleapis.com/auth/meetings.space.readonly`.
The Meet read-only scope is sensitive. Public external deployment normally needs
sensitive-scope verification unless a documented exception applies.

The inspected public policy, `frontend/app/privacy/page.jsx:27`, describes student/admin
operational information but does not disclose Google identity, Meet participants/sessions,
attendance evidence storage/use, or Google-data sharing practices. Prepare an accurate,
owner-approved policy before public Google verification; this audit did not invent retention,
deletion or legal commitments or rewrite legal pages.

Cloud publishing/verification status is unknown. External OAuth Testing mode limits users
and refresh-token lifetime: with the Meet scope, the basic-identity-only exception does not
apply and refresh tokens normally expire after seven days. Do not promise authorize-once
operation while relying on Testing mode.

Official sources reviewed:
- [Meet authorization and scope classifications](https://developers.google.com/workspace/meet/api/guides/authenticate-authorize?hl=en)
- [Sensitive-scope verification, privacy and exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [OAuth refresh-token expiration](https://developers.google.com/identity/protocols/oauth2)

### High: runtime dependency security review remains open (unresolved)

Read-only `npm audit --omit=dev --json` reported 11 vulnerable package paths in each project:
backend: 1 critical, 7 high, 2 moderate, 1 low; frontend: 1 critical, 7 high, 3 moderate.
Counts include inherited package findings, not 22 independently exploitable application bugs.

The installed frontend runtime is Next.js 16.2.6 (`frontend/package.json:20` declares a range).
The production build uses Turbopack and the app has a proxy and image optimization surface.
Current advisories cover those surfaces and static-page caching. A narrow supported patched
Next.js release, its image dependencies, and regression checks need review before release.
No exploit was attempted; not every advisory's preconditions were proven.
See [Next.js image-optimization advisory](https://github.com/advisories/GHSA-cjq9-62q9-8jv4)
and [Turbopack proxy advisory](https://github.com/advisories/GHSA-6gpp-xcg3-4w24).

Reachability distinctions:
- No `use server` or `ImageResponse` implementation was found in the inspected app source;
  Server Action/next-og advisories are not demonstrated application exploits here.
- Windows-specific RCE depends on Windows hosting; hosting is unknown.
- SheetJS is used to write ledger exports, not parse uploaded workbooks. Its parsing
  advisories were not shown reachable in this flow; npm reports no package fix.
- The backend proxy-addr critical advisory concerns IPv4-mapped subnet trust. This app
  uses numeric `trust proxy = 1`, not that subnet configuration.
- Axios provider calls do not visibly accept arbitrary user-provided destinations in
  these services. Prototype-pollution and proxy/redirect prerequisites were not established.
- Prisma config/PostCSS/source-map findings primarily concern tooling in inspected paths;
  untrusted configuration/CSS inputs were not found.
- Body-parser uses an explicit valid size limit; the invalid-limit advisory condition was
  not found. DOMPurify in-place sanitization was not found in the inspected UI.

No dependencies/lockfiles were changed; no forced audit fix or broad upgrade was run.
Use a focused security patch review rather than treating every audit recommendation,
including suggested Prisma version changes, as safe automatically.

### Medium: missing backend URL silently targeted loopback in production (fixed)

`frontend/next.config.ts:64` previously rejected missing API configuration only on Render.
A production configuration test without Render variables reproduced a rewrite to localhost.
It now rejects missing backend URL on every production host. Configured rewrite destinations
and the local development fallback are unchanged. Reproduction failed before the change and
passes afterward. Explicitly configured URLs still need deployment review for correct HTTPS
origin/path; the guard is not a validator of every possible mistaken URL.

### Medium: ingress/IP trust must be confirmed

`backend/middleware/security.js:7` reads the first raw `X-Forwarded-For` value before
Express's trusted `req.ip`; some limiting keys use this fallback. If ingress preserves a
client-supplied leading value, clients can vary IP-based limiting keys. Email-based keys
and OTP attempt controls remain present. Verify that the production ingress replaces or
sanitizes forwarding headers and that one proxy hop is correct. No ingress exploit was
performed, and shared middleware was not changed without deployment evidence.

### Medium: always-on polling/pool behavior cannot be certified from local code

`backend/server.js:184` starts the Meet worker after database initialization.
`backend/services/meetVerificationService.js:238` defaults polling on unless
`ENABLE_MEET_POLLING` is exactly `false`. It runs one sequential worker per process, with
non-overlapping timers, database lease claims, token-conditional lease release, and persisted
next-check timestamps. `RUN_SCHEDULED_JOBS` controls separate general cron jobs, not Meet.
Current startup logs distinguish these settings correctly.

Production must use an always-on Node service, not a sleeping/free service or request-only
serverless function. Per-process concurrency is one; multiple replicas/manual checks can
still increase total database/API load. Leases prevent duplicate processing of one class,
not arbitrary global throughput. Validate replica count and provider connection budget.

Only one application PrismaClient constructor was found (`backend/prisma/client.js:8`).
Google requests are outside finalization/token-storage transactions. Existing read/session
recovery is bounded and temporary database failures are not converted into authentication
failure. A read-only development inspection succeeded; prior Closed/P2024 failures were
not reproduced, and their root cause is not established by this audit. Local configuration
has TLS settings but no explicit pooler flag, direct URL or pool-size overrides. This alone
does not prove incompatibility. Confirm the provider's exact pooler/migration requirements,
observe connection usage under realistic load and shutdown/restart behavior. Do not blindly
raise connection limits or use transaction-pool credentials for migrations without review.

### Low / feature limitations, not silently completed workflows

- `backend/services/adminStaffOverviewService.js:120`: admission enquiries have no saved
  data source; forms/export remain unavailable rather than inventing records.
- `backend/services/staffPaymentService.js:23`: authoritative QR/UTR verification is
  unavailable. Entering a UTR cannot mark a fee paid. Existing cash accounting is connected.
- Follow-up storage contains notes/author/student/timestamps, but not call status or
  expected/next payment dates. Pending/upcoming follow-up scheduling is not implemented.
  The Staff dashboard wording claiming no saved follow-up source exists is stale
  (`frontend/app/staff/StaffScreens.tsx:112`); saved-note timelines do exist. No new
  scheduling workflow was added during this audit.
- Student batch filtering is unavailable because the student model has no batch field.
- Five faculty records matched possible fixture heuristics (FACPTseed code, Codex name,
  or example-domain email). These are candidates, not proven disposable accounts. Review
  them privately before any cleanup; none were removed. No matching Staff/class fixtures
  were found using the limited heuristics.

## Implementation safeguards inspected

- Staff creation is Admin-only; exact challenge/admin binding, normalized email, hashed
  six-character OTP, five-minute expiry, attempt limits, resend cooldown and single-use
  verification are enforced server-side. Password hashes are excluded from list responses.
- Staff reset uses its own purpose/account/password binding, string OTP and single-use
  grant; password changes revoke Staff sessions. Existing role flows were not rewritten.
- Staff has scoped endpoints, not access to generic Admin payment APIs. Follow-up authors
  are server-derived; histories are Staff/Admin only and rendered as plain text.
- Cash recording delegates to existing accounting, calculates amount server-side, checks
  existing payments/in-flight gateway orders, and uses serializable retries/advisory locks
  and unique student/month/session identity. Staff reversal is not exposed.
- Current-session genuine 401 handling is distinguished from 403/500/network/stale-token
  responses in shared auth helpers. Backend unavailable responses retain valid sessions.
- Daily attendance derives weekday/weekend rate from the IST attendance date, keeps
  legacy amounts, guards ownership/duplicates, preserves overrides and settled protections,
  and enforces previous-week Friday noon on the server. Extra incentives remain separate.
- Copy sets retain quantity, note and rate snapshots; editing/payments share the operation
  lease and paid sets are locked. Admin pending aggregates use the accounting entries.
- Google state is random, expiring and single-use; authenticated browser preparation,
  PKCE S256 and nonce binding precede callback exchange. Google's supported ID-token library
  validates signatures with audience/issuer/expiry/nonce checks. Stable subject is mapped
  to Meet `users/{id}`; display names are never teacher identity evidence.
- Tokens/PKCE material are faculty-bound AES-256-GCM encrypted, not frontend fields.
  Missing refresh tokens preserve same-account credentials; disconnect/reconnect CAS
  prevents an old refresh from resurrecting disconnected credentials.
- Matching uses exact Meet space and bounded start window (15-minute tolerance), detects
  reused/ambiguous calls, accepts live calls without endTime, paginates participants/sessions,
  merges reconnect intervals and credits only actual completed, fully retrieved attendance
  with verified teacher and a distinct signed-in attendee. No minimum duration was added.
- Scheduled/Cancelled only are deletable; actual lifecycle evidence blocks cancellation
  bypass. Tombstones/unique conference IDs retain deduplication evidence. Paid/processing
  accounting remains protected. Legacy classes are not retroactively auto-credited.
- Multi-batch selection stores one class and one incentive; filters use any association
  without duplicating classes. Directory options are independent of filtered history;
  deactivation preserves snapshots/history and rejects new selections.
- Native dialog/top-layer modals provide centered backdrop, scrolling/focus handling.
  CORS uses explicit origins, body limits and existing raw webhook parsing remain intact.
  Application bearer auth is not supplied by a cross-site cookie; OAuth uses its own
  browser-bound cookie. Production proxy/cookie policies still need real browser testing.

## Real development database evidence (read-only)

- 46 migrations recorded; `prisma migrate status` reports up to date. No pending local
  migrations. All 12 integration migrations listed below are applied in this database.
- Actual `FacultyOnlineClass_status_check` allows SCHEDULED, LIVE, COMPLETED, CANCELLED;
  time check requires endsAt > startsAt. Lifecycle and verification fields remain distinct.
- Actual unique indexes: Staff email; class conferenceName; class incentiveEntryId;
  faculty/requestId; class/batch composite key; per-faculty accounting-lock primary key.
- One connected Google account has verified identity; no non-deleted online classes or
  multi-batch sessions exist currently in this development dataset. Thirty batches are active.
- Local callback uses the correct route but development HTTP origins. Encryption key
  decodes to 32 bytes. No URL, credentials, token or participant details were printed.

## Checks and limitations

- `node --test tests/*.test.js`: 148 passed, 4 skipped, 0 failed after the fix.
  Skipped suites are opt-in PostgreSQL write tests; they were not enabled on the existing
  dataset. Most service/authorization/concurrency verification uses isolated in-memory mocks.
- Focused Meet regression: 23 passed; payout lease test failed before and passed after fix.
- `npx prisma validate`: passed. Actual constraints/indexes were queried inside a read-only
  transaction and rolled back. No migration/generate/database write was needed.
- `node --check services/meetVerificationService.js` and `git diff --check`: passed.
- Frontend targeted ESLint and `npx tsc --noEmit --incremental false`: passed.
- `npm run build`: passed, including a repeat after the production rewrite guard change.
- Configuration reproduction: missing production URL rejects; development fallback and
  explicitly configured production backend remain unchanged (isolated VM configuration test).
- Playwright with all APIs mocked: Admin/Faculty Online Classes at 320, 341, 390, 768,
  1366px; empty/filtered directory options, multi-selection, no form stretch, panel bounds,
  Escape/Done/outside close, focus return, scoped checkbox sizes, valid submit wiring,
  date picker, Google modal, Admin batch/edit/delete dialogs. No page horizontal overflow.
- Login browser tests: same widths, all four roles, student-only signup, recovery/OTP
  transitions, password visibility and endpoint wiring; logo aspect ratio, four external
  link destinations, keyboard focus. External destinations were intercepted, not real visits.
- Staff browser checks: all six page shells at the same five widths with mocked empty
  records and a long layout-only profile. No page horizontal overflow; mobile drawer is
  fixed and locks body scrolling. Profile and follow-up screenshots were captured. A first
  harness run used the wrong activity response field and crashed; correcting the mock to
  the real `activity` contract made the checks pass without changing application code.
- Unauthenticated real local GETs to Staff members/students/timeline and faculty/admin
  incentive class lists returned 401. An initial guessed Admin route returned 404;
  the actual protected route is under `/api/faculty-extra-incentives/admin/online-classes`.
- Fresh real Resend delivery, account/reset creation, real Google consent/meeting evidence,
  real payouts and real PostgreSQL concurrent mutation tests were NOT performed. Production
  role sessions, load, provider pooler and worker restart were not end-to-end tested.
- Full browser testing of every Admin/Faculty attendance/payroll/PDF state was not repeated;
  scoped unit tests and source review cover those invariants, not a complete visual certification.

## Exact environment names and manual setup

Backend required by current startup: `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`, `EMAIL_FROM`,
`RESEND_API_KEY`, `BACKEND_URL`, `CASHFREE_CLIENT_ID` (or `CASHFREE_APP_ID`),
`CASHFREE_CLIENT_SECRET` (or `CASHFREE_SECRET_KEY`), `CASHFREE_ENVIRONMENT`,
`CASHFREE_RETURN_URL`. Keep existing payment mode/configuration unchanged.

Integration: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
`GOOGLE_TOKEN_ENCRYPTION_KEY`, `FRONTEND_URL`, `CORS_ORIGIN` (and existing `ALLOWED_ORIGINS`
where used), `NOTIFICATION_EMAIL_ENABLED`, `RESEND_FROM_EMAIL` with `EMAIL_FROM` fallback.
Optional existing session settings: `MAX_ACTIVE_SESSIONS_PER_USER`,
`SESSION_IDLE_TIMEOUT_MINUTES`, `ACCESS_TOKEN_EXPIRY_MINUTES`.

Meet: `ENABLE_MEET_POLLING` (literal false disables it). General job process:
`RUN_SCHEDULED_JOBS`, `REMINDER_CRON`, `REMINDER_TIMEZONE`,
`BACKGROUND_JOB_POLL_INTERVAL_MS`, `BACKGROUND_JOB_BATCH_SIZE`,
`BACKGROUND_JOB_STALE_MINUTES`. Do not confuse general jobs with Meet polling.

Preserve optional payout configuration: `CASHFREE_PAYOUT_CLIENT_ID`,
`CASHFREE_PAYOUT_CLIENT_SECRET`, `CASHFREE_PAYOUT_ENVIRONMENT`,
`CASHFREE_PAYOUT_API_BASE_URL`, `CASHFREE_PAYOUT_WEBHOOK_SECRET`,
`ENABLE_CASHFREE_PAYOUT_SANDBOX`, `ENABLE_REAL_CASHFREE_PAYOUTS`, `BACKEND_PUBLIC_URL`,
and student `CASHFREE_WEBHOOK_SECRET`. This audit did not enable real payouts.

Frontend: prefer server-only `BACKEND_URL` for `/api` rewrites and relative browser API base;
existing alternatives are `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_API_URL`.
Preserve existing server-only `CRM_API_KEY` for the current proxy.
Never put database, Google client secret/encryption key, Resend or payment secrets in
`NEXT_PUBLIC_*`. No environment file was changed.

Manual Google Cloud/hosting actions:
1. Enable Meet REST API; configure a Web OAuth client with the exact HTTPS backend callback
   `/api/faculty/google/callback`. Match configured frontend HTTPS return origin and CORS.
2. Declare only openid and meetings.space.readonly; review applicable verification exception
   or publish/verify for external production. Confirm domain ownership, public homepage,
   policy link, support contacts and demonstration/justification in Verification Center.
3. Keep development and production OAuth projects/configuration separate. Existing accounts
   without verified subject must reconnect once; Testing-mode token reconnection is not a
   durable production strategy. Test third-party cookie policies on real production origins.
4. Persist the same canonical Base64-encoded 32-byte encryption key across restarts/replicas
   in the secret manager, with a secured backup. Never regenerate it on startup.
5. Run an always-on backend with Meet enabled and observed DB/API budgets. General jobs,
   if needed, use the existing dedicated `npm run jobs` process. Monitor lease/retry/status
   backlog, API 429s, database errors and verification-review queues.
6. Configure ingress to redact OAuth callback code/state/ticket queries from access logs;
   these are short-lived OAuth values, not Flowlytiks login tokens, but should remain private.

## Migration and deployment order (instructions only; nothing deployed)

Production pending migrations are UNKNOWN without querying the production migration table.
Do not assume the local status applies there. The integration migration set to compare is:

```
20261008090000_add_staff_auth
20261009090000_add_staff_student_follow_ups
20261009160000_daily_faculty_attendance
20261010160000_faculty_online_doubt_classes
20261011100000_faculty_google_connection
20261011150000_verify_online_meet_attendance
20261012010000_allow_live_online_class_status
20261012020000_faculty_google_verified_identity
20261012030000_extra_incentive_operation_lock
20261012040000_online_class_deletion_tombstone
20261012050000_online_class_directory
20261012060000_online_class_multiple_batches
```

1. Review/retain all pre-existing dirty/untracked integration files in a coherent release;
   migrations/services are not safely packaged merely because a local build can find them.
2. Resolve security/Google gates. Take a provider snapshot/logical backup, verify restore
   procedures, and back up encryption secrets separately with restricted access.
3. In an authorized release window, stop/drain Meet and payment writers. Inspect production
   `prisma migrate status`, all pending SQL and actual constraints/indexes. Do not mark missing
   migrations applied or accept a reset. Use the provider-approved migration connection.
4. Apply only reviewed forward migrations using the established deployment workflow
   (`prisma migrate deploy`, not dev/reset/db push), then generate Prisma Client and start
   compatible backend code. No production migration was run during this audit.
5. Build frontend with its correct production backend origin, then enable monitored Meet
   polling. The root health route is liveness only; verify authenticated DB-backed reads
   and constraint presence before declaring readiness.
6. Rollback should disable polling/writers and restore a known compatible app version;
   do not drop additive tables or reverse settled accounting. Database restore is a last,
   coordinated option after reviewing writes since backup and restore impact.

Focused authorized production smoke test: role login/navigation/reload/logout and forbidden
API access; one controlled Staff verification/reset with leading-zero coverage in staging;
student/follow-up filtering and PDFs; attendance weekday/weekend/Friday-noon boundaries and
override totals; incentive pending snapshot/edit locks; active/deleted batch options;
real Google reconnect/refresh/disconnect on production origins; one approved meeting with
verified teacher and participant, restart during polling, persisted attendance/PDF, exactly
one credit and deletion restrictions. Do not trigger real transfers or notifications as
an automatic smoke test; use staging/explicitly authorized test accounts.

## Files changed by this audit only

- `backend/services/meetVerificationService.js`: accounting-lease guard before crediting.
- `backend/tests/meetVerification.test.js`: active payout lease and retry regression fixture.
- `frontend/next.config.ts`: production backend configuration fail-fast on every host.
- This report. Temporary inspection/browser scripts and screenshots are outside the repository.

All other dirty/untracked files predated this audit and were preserved. No project files
were deleted, no stash/reset/clean was used, no database records were written, no migrations
were created/applied, no notifications/transfers were sent, and nothing was committed,
pushed or deployed. Cashfree/student payment/receipt rules, attendance/payroll rates,
incentive rates, settled balances, authentication contracts and unrelated layouts remain
unchanged. The only accounting change is synchronization preventing the reproduced race.
