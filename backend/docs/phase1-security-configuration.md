# Phase 1 security configuration

The backend currently trusts one proxy hop (`app.set("trust proxy", 1)`). This
matches a single trusted ingress immediately in front of Express, but the
repository does not define the production ingress topology. Before deployment:

- Verify every public path has the same trusted hop count. Do not use `true`.
- Ensure the ingress overwrites forwarded headers and does not permit clients
  to bypass it and reach Express directly. If paths differ, configure explicit
  trusted proxy addresses/CIDRs instead of trusting a numeric hop count.
- Verify the frontend reverse proxy and hosting edge preserve the expected
  forwarding chain. Rate limiting and request logging now use Express `req.ip`,
  not a client-selected first `X-Forwarded-For` value.
- PostgreSQL must support transaction-scoped advisory locks. Rate-limit budget
  checks use `ReadCommitted` transactions, so a waiter sees the preceding
  committed insertion after acquiring the per-key lock. Pool/transaction failures
  fail closed in production with 503; no external calls occur inside this lock.

PhonePe runtime endpoints and configuration are retired. Historical fields,
receipts and migrations remain intact. Remove obsolete `PHONEPE_MERCHANT_ID`,
`PHONEPE_SALT_KEY`, `PHONEPE_SALT_INDEX` and `PHONEPE_BASE_URL` manually from
hosting/local secret stores. No local environment file was edited.

This change does not establish the cause of PostgreSQL connection closures or
P2024. Confirm provider/pooler requirements and process counts separately; do not
raise connection limits merely to mask errors.

## Changes and validation (2026-10-12)

- PhonePe initiate/callback/status routes and their exclusive controller/config
  were removed. No exclusive third-party dependency was found. Legacy payment
  fields, receipts, reversal safeguards and migration history were retained.
- Cashfree verification now permits only Admin and Student, before order lookup.
  Student ownership, checkout and webhook reconciliation rules are unchanged.
- Logging removes URL query strings, nested credential fields and secret-bearing
  diagnostic strings. Cashfree debug logs no longer print raw responses or
  checkout session tokens. Known database error codes remain available.
- The six lint errors were corrected without suppressions: hydration-safe client
  snapshots replace effect-only readiness state; sidebar state tracks navigation;
  chat history initializes state without reading a ref during render.

### Files changed by this task

Backend:

- `backend/config/env.js`
- `backend/config/phonepe.config.js` (removed retired code)
- `backend/controllers/phonepecontroller.js` (removed retired code)
- `backend/controllers/cashfreecontroller.js`
- `backend/routes/paymentroute.js`
- `backend/middleware/security.js`
- `backend/utils/appLogger.js`
- `backend/server.js`
- `backend/package.json`
- `backend/package-lock.json`
- `backend/tests/securityHardening.test.js` (new)
- `backend/tests/paymentAuthorization.test.js` (new)
- `backend/docs/phase1-security-configuration.md` (new)

Frontend:

- `frontend/app/payment-success/PaymentSuccessContent.jsx`
- `frontend/app/faculty/FacultyPortalLayout.tsx`
- `frontend/app/faculty/assistant/page.tsx`
- `frontend/app/faculty/attendance/page.tsx`
- `frontend/app/faculty/dashboard/page.tsx`
- `frontend/lib/useSessionChatHistory.js`
- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/next-env.d.ts` (Next 16.3.8 generated type reference)

### Dependency targets

| Package | Resulting version |
| --- | --- |
| Next / eslint-config-next | 16.3.8 / 16.3.8 |
| Prisma CLI / Client | 6.19.2 / 6.19.2 |
| Axios (both projects) | 1.20.0 |
| proxy-addr | 2.0.8 |
| body-parser / qs | 2.3.0 / 6.16.0 |
| backend follow-redirects / form-data | 1.16.1 / 4.0.6 |
| defu | 6.1.7 |
| DOMPurify / fflate | 3.4.17 / 0.8.3 |
| source-map-js / baseline-browser-mapping | 1.2.2 / 2.11.28 |
| brace-expansion (compatible ranges) | 1.1.21; nested compatible versions patched |

Install/update commands used `--ignore-scripts`; Prisma Client generation was
run separately and did not connect to or migrate the database.

### Checks

- Non-PostgreSQL Node regression suite: 158 passing tests; persistence, email and
  provider access are mocked. New focused security tests: 10 passing.
- Tests cover removed PhonePe routes, Cashfree role/ownership guards, reusable
  checkout, signature/deduplication, authoritative success versus an untrusted
  success payload, concurrent budgets, expiry, failure-closed behavior and log
  sanitization.
- `tsc --noEmit --incremental false`: passed.
- `npm run lint`: zero errors, 61 warnings. Existing warnings remain; the matched
  Next lint version additionally detects existing internal location navigation.
- `npm run build`: passed (Next 16.3.8).
- `git diff --check`: passed; source secret-pattern scan found no high-confidence
  matches (not an exhaustive security guarantee).
- Final runtime audit: backend 4 high findings in Prisma CLI/config dependencies;
  frontend 1 high finding in XLSX. No critical findings remain.
- Including development tools: backend 7 high; frontend 14 high, 1 moderate,
  1 low. These are package audit counts, not demonstrated exploits.

### Remaining dependency limitations

Prisma 6.19.2 pins deepmerge-ts 7.1.5 and effect 3.18.4. The deepmerge fix requires
8.x; forcing it, downgrading Prisma or making a speculative major upgrade was
not performed. No user-controlled recursive-object/config input path was found
in the server. Development lint/watch tool advisories also remain and need a
separate compatibility review; suggested toolchain downgrades were not forced.

XLSX 0.18.5 has no npm audit fix. Inspected usage is workbook export, not parsing
untrusted workbooks. Replacing its distribution/library requires a separately
reviewed change rather than silently altering report functionality.

No real database, payment, email, Google or payout integration test was run.
In particular, the lock concurrency regression uses a controlled transaction
store, not a live PostgreSQL test. Production ingress and pooler behavior remain
deployment checks. No migrations, historical-record changes, commits or deploys
were performed; existing unrelated working-tree changes were preserved.
