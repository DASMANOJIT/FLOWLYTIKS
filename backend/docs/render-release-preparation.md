# Render release preparation

Prepared 14 October 2026. **Preparation only; production sign-off remains BLOCKED.**
No deployment, push, migration, application database query/write, secret rotation,
or environment-file change was performed for this document.

## Evidence and release boundary

Read the Phase 1 security configuration, Phase 2 functional, Phase 3 financial
integrity and Phase 4 performance/reliability reports, and inspected current
routes, manifests, environment handling, migrations and worker configuration.
Their latest continuation sections supersede earlier unresolved local items.

- Phase 2: requested local lock, browser-to-real-API and export cases passed;
  actual deployment ingress/pooler/provider integration remains unverified.
- Phase 3: local financial checklist passed with disposable PostgreSQL and
  mocked providers; production sign-off remains blocked.
- Phase 4: local PASS WITH FINDINGS. The 50-user read workload achieved about
  95 requests/second and p95 20 ms. The completed 20-minute soak had 6,502
  successful requests, no unexpected errors and p95 31.3 ms. Connections remained
  stable and no sustained memory leak was demonstrated. These are not Render
  capacity guarantees. Original remote Closed/P2024 causes remain unresolved.
- Provider calls were mocked in automated validation. No real Google, Cashfree
  or Resend staging certification follows from these results.
- The checkout baseline is `fda87d89`; the release implementation is still a
  large dirty working tree, including untracked services, tests and migrations.
  A reviewed, immutable release revision and previous deploy revision must be
  recorded before deployment. This document does not commit or push them.
- No Render Blueprint/deployment manifest was found. Dashboard configuration,
  linked repository/revision, plan and instance counts cannot be inferred.

## Callback and origins

**The supplied callback is correct for the implemented route:**

`https://flowlytics-backend.onrender.com/api/faculty/google/callback`

Mount chain: `server.js` mounts `/api/faculty`, `facultyroute.js` mounts `/google`,
and `facultygoogleroute.js` implements GET `/callback`.
A read-only GET to `https://flowlytics-backend.onrender.com/` returned HTTP 200
and `Server is running...`. This confirms a reachable backend at that exact
hostname, not its deployed revision or Render environment values. Note the
hostname spelling **flowlytics-backend**.

The ignored local configuration still correctly uses localhost for development.
Do not replace it with production settings. In Render, separately confirm the
backend service's Google redirect value exactly matches the saved Cloud callback
above, with no trailing slash, query or fragment.

Frontend origins present in source include `https://www.flowlytiks.in`,
`https://flowlytiks.in` and `https://flowlytiks-frontend.onrender.com`. Confirm the
actual canonical frontend and active aliases in the dashboards; their presence
in a CORS allowlist does not establish deployment ownership or availability.

## Environment inventory

Set values through the intended Render service's secret/configuration controls
only after approval. Preserve existing secrets and operational values. No secret
values are included below. Backend secrets must never become `NEXT_PUBLIC_*`.

### New backend Google and polling configuration

| Exact name | Required release setting |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Existing Google OAuth client, backend only. |
| `GOOGLE_CLIENT_SECRET` | Existing client secret, backend only. |
| `GOOGLE_REDIRECT_URI` | `https://flowlytics-backend.onrender.com/api/faculty/google/callback` |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Preserve the existing canonical base64 key decoding to exactly 32 bytes. AES-256-GCM encrypted credentials depend on it; keep identical across replicas and recovery. |
| `FRONTEND_URL` | Confirmed canonical HTTPS frontend origin; used for OAuth return and CORS. |
| `ENABLE_MEET_POLLING` | Explicit `true` for continuous tracking after validation. `false` disables the embedded Meet worker; default is enabled. |

The five Google/return variables were added to `backend/.env.example` by the
existing implementation. Polling is consumed by source even though its toggle
is not listed there. Local key format was privately verified; no key was printed,
generated or changed. If a genuinely new deployment has no key, follow
`docs/faculty-google-connection.md` and transfer a securely generated key directly
into its secret store. Never regenerate an existing key on startup.

### Existing backend settings that must be reviewed/preserved

| Exact names | Requirement / known non-secret value |
| --- | --- |
| `NODE_ENV`, `PORT` | `production`; use Render's assigned `PORT`. |
| `DATABASE_URL` | Intended production database, privately verified before any migration. Never reuse the confirmed development target merely because it is configured locally. |
| `JWT_SECRET` | Existing sufficiently strong secret, at least 32 characters under current validation. Preserve rather than rotate during release. |
| `MAX_ACTIVE_SESSIONS_PER_USER`, `SESSION_IDLE_TIMEOUT_MINUTES`, `ACCESS_TOKEN_EXPIRY_MINUTES` | Retain approved current session policy; example values are not a reason to change it. |
| `BACKEND_URL` | `https://flowlytics-backend.onrender.com`; required in production and used for payment notification URLs. |
| `BACKEND_PUBLIC_URL` | Optional existing URL setting; not a substitute for the required `BACKEND_URL`. |
| `CORS_ORIGIN`, `ALLOWED_ORIGINS` | Exact approved frontend origin(s), not wildcard. Ensure credentialed Google prepare requests work. |
| `EMAIL_FROM`, `RESEND_API_KEY` | Existing working backend OTP sender and provider key; required by startup validation. |
| `RESEND_FROM_EMAIL`, `NOTIFICATION_EMAIL_ENABLED` | Faculty sender, falling back to `EMAIL_FROM`; `true` to send faculty payout confirmations. Verify the existing sender/domain in Resend. |
| `PAYMENT_MODE` | Explicit release decision: `CASHFREE` or retained temporary `MANUAL_UPI`; must match frontend mode. Local configuration currently uses `MANUAL_UPI`. Do not silently switch. |
| `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET` | Existing checkout credentials; supported aliases `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`. Keep environment consistent. |
| `CASHFREE_ENVIRONMENT`, `CASHFREE_RETURN_URL` | Approved Cashfree environment; return URL `<confirmed frontend origin>/payment-success`. |
| `CASHFREE_WEBHOOK_SECRET` | Existing webhook signing configuration; code supports the established client-secret fallback. Confirm the actual merchant configuration. |
| `CASHFREE_PAYOUT_CLIENT_ID`, `CASHFREE_PAYOUT_CLIENT_SECRET`, `CASHFREE_PAYOUT_WEBHOOK_SECRET` | Separate payout credentials/signing secret; preserve correct merchant values. |
| `CASHFREE_PAYOUT_ENVIRONMENT`, `CASHFREE_PAYOUT_API_BASE_URL` | Approved environment; production base `https://api.cashfree.com/payout`, sandbox `https://sandbox.cashfree.com/payout`. |
| `ENABLE_REAL_CASHFREE_PAYOUTS`, `ENABLE_CASHFREE_PAYOUT_SANDBOX` | Explicit approved operational gates. Do not enable real transfers as a release test. |
| `DEBUG_DB`, `DEBUG_ENV_LOAD`, `DEBUG_AUTH`, `DEBUG_SIGNUP`, `DEBUG_CASHFREE` | Keep disabled for production unless narrowly authorized sanitized diagnostics are required. |

PhonePe runtime was retired in previous work. Obsolete secret names for manual
review are `PHONEPE_MERCHANT_ID`, `PHONEPE_SALT_KEY`, `PHONEPE_SALT_INDEX` and
`PHONEPE_BASE_URL`. This task does not inspect/print their values or remove them.
Historical payment fields/migrations remain intact.

### Frontend configuration

| Exact name | Release setting |
| --- | --- |
| `BACKEND_URL` | Server-only `https://flowlytics-backend.onrender.com`, used by Next rewrites and CSP configuration. |
| `NEXT_PUBLIC_API_URL` | Omit/empty for the current relative `/api/...` proxy design. Do not set `/api`, which would duplicate the prefix in current callers. |
| `NEXT_PUBLIC_BACKEND_URL` | Optional fallback; omit unless intentionally needed. Do not leave a localhost value in Render. |
| `CRM_API_KEY` | Existing server-only CRM availability/license integration; preserve and verify real staging availability. |
| `NEXT_PUBLIC_PAYMENT_MODE` | Match backend `PAYMENT_MODE`; do not change the temporary manual mode without approval. |
| `NEXT_PUBLIC_MANUAL_UPI_ID`, `NEXT_PUBLIC_MANUAL_UPI_PHONE`, `NEXT_PUBLIC_MANUAL_UPI_QR_PATH` | Existing public payment-display settings if manual mode remains enabled. Existing QR path fallback `/fees-payment.jpg`; validate actual payee/asset manually. |
| `NEXT_PUBLIC_RENDER_DEBUG`, `NEXT_PUBLIC_DEBUG_SIGNUP` | Disabled (`0`) for production. |

There are no new frontend Google secrets or Staff-specific authentication secrets.
Public variables/CSP/rewrites require a frontend build after configuration changes.
Current local frontend URLs are localhost; these must not be copied to Render.
The Next app needs a server-capable deployment for API rewrites, not a static
export. No environment files were modified.

## Migration inventory and safe order

There are 46 migration directories. These 12 new release migrations are
**candidate pending migrations**, not a verified production pending list:

| Migration | Purpose |
| --- | --- |
| `20261008090000_add_staff_auth` | Staff accounts and secure creation challenges. |
| `20261009090000_add_staff_student_follow_ups` | Student/staff note relationships and indexes. |
| `20261009160000_daily_faculty_attendance` | Add DAILY enum value without rewriting legacy shifts. |
| `20261010160000_faculty_online_doubt_classes` | Online class records and unique linked incentive. |
| `20261011100000_faculty_google_connection` | Encrypted connection and OAuth state storage. |
| `20261011150000_verify_online_meet_attendance` | Conference evidence, attendance, verification and worker leases; legacy tracking remains disabled. |
| `20261012010000_allow_live_online_class_status` | Transactionally replace lifecycle check with SCHEDULED/LIVE/COMPLETED/CANCELLED support. |
| `20261012020000_faculty_google_verified_identity` | Stable Google subject, verification timestamp and nonce hash. |
| `20261012030000_extra_incentive_operation_lock` | Existing-operation serialization lease table. |
| `20261012040000_online_class_deletion_tombstone` | Preserve exclusion/deduplication on deletion. |
| `20261012050000_online_class_directory` | Batch/legacy grade directory; keep historical grade storage. |
| `20261012060000_online_class_multiple_batches` | Multi-batch junction with name snapshots, one session/incentive. |

These SQL files were inspected: no data deletion, DROP TABLE or DROP COLUMN.
The LIVE migration drops and immediately replaces a CHECK inside a transaction;
it does not remove lifecycle validation. Additive does not mean lock-free or
failure-proof: constraints, uniqueness and DDL locking still require staging.

**Production migration status is unknown.** Obtain its read-only migration ledger,
checksums, failed/incomplete entries and actual constraints first. `migrate deploy`
applies all pending migrations, not just the 12 above. Older history contains
column/table drops (including retired notification/OTP/provider fields); any
unexpected older pending migration requires separate review before execution.
Do not edit applied SQL or mark an unapplied migration as applied.

Future authorized deployment sequence (none executed here):

1. Record release revision, previous successful deploy/artifact and configuration
   versions. Include all required untracked release modules/assets/migrations.
   Confirm auto-deploy settings before any future push.
2. Confirm production database identity/provider and obtain a fresh backup.
   Restore it into an isolated environment and verify financial reconciliation.
3. Rehearse the complete pending migration sequence against that restored copy;
   verify schema guard, LIVE constraint, legacy amounts and required uniqueness.
4. Schedule a controlled write/worker pause and drain active jobs for migration.
   Preserve webhook delivery/replay and reconcile messages arriving during the
   pause. Render pre-deploy runs while the old web revision may still serve
   traffic, so do not assume it quiesces all writers automatically.
5. Use one migration owner with a direct provider connection, securely injected
   as the migration process's `DATABASE_URL`. Future commands: `npx --no-install
   prisma migrate status`, then only the reviewed `npx --no-install prisma migrate
   deploy`. Recheck status and actual PostgreSQL constraints afterward.
6. Backend build: `npm ci` (existing postinstall generates Prisma Client).
   Start: `npm start`. Initially hold Meet polling with
   `ENABLE_MEET_POLLING=false` until schema/health checks succeed. Confirm database
   readiness and authenticated queries, not just the root HTTP 200.
7. Frontend build: `npm ci` then `npm run build -- --webpack`, matching the tested
   build path. Start: `npm run start -- --hostname 0.0.0.0 --port $PORT`.
   Configure the intended service root directories `backend` and `frontend`.
8. Validate real staging consent/webhooks/senders and smoke checks; then enable
   Meet polling and any approved existing general worker. Review queued work
   before starting it. Monitor rolling-deploy overlap and database capacity.

Do not run migrate dev/reset, db push, seed or manual destructive SQL in this
sequence. Most migration files are not wrapped in an explicit transaction; a
failed migration can leave partial DDL. Stop and inspect rather than blindly
retrying or fabricating migration resolution.

## Workers, proxy and database connections

| Area | Verified source behavior | Deployment evidence still needed |
| --- | --- | --- |
| Meet | Embedded in API server after database readiness; sequential 30-second loop, up to 10 due classes, persisted renewable leases/backoff, shutdown draining. | Always-on paid/appropriate compute, replica count, quota and shutdown grace. Free web sleep cannot provide continuous tracking. |
| General jobs | API does not start general dispatcher. Separate `npm run jobs` starts it; `RUN_SCHEDULED_JOBS=1` also registers scheduled jobs. | Whether existing worker is deployed, one scheduler owner, queue contents, recipient approval and resource budget. `RUN_SCHEDULED_JOBS=0` still dispatches queued jobs. |
| Proxy | `app.set("trust proxy", 1)`; Next forwards relative API requests; Google prepare/webhooks can reach Express directly. | Actual public/custom/private ingress chain, any CDN, socket peer/forwarded-header handling and spoof tests for every path. One hop is not proven by the Render name. |
| Pooler | All remaining protected locks use transaction-bound queries; provider network calls are outside long transactions. | Actual production database endpoint/product/version/mode, TLS/prepared-statement requirements and isolated same-pooler tests. |
| Recovery | Local terminated-connection/transport tests recover and preserve valid role sessions. | Original remote Closed/P2024 stacks, provider termination logs, Render restarts and per-process connection/query-duration telemetry. |

No `TRUST_PROXY` environment switch is implemented. `ENABLE_BACKGROUND_JOBS` is
not a supported production switch for these entrypoints. `npm run jobs` does not
start Meet polling. Do not invent configuration values for nonexistent switches.

Private URL metadata identifies the configured **development** target as Prisma
Postgres direct access; it is not evidence of the production target. Official
Prisma Postgres documentation describes transaction pooling for its pooled
endpoint and direct access for migration/backup operations. Current schema/config
consume only `DATABASE_URL`; adding `DIRECT_URL` alone does not change them.
Choose provider-issued connection settings only after production confirmation.
Do not blindly append pooler flags or increase limits/timeouts.

Budget connections across API replicas, the separate job worker, old/new rolling
revisions and migration/administration reserve against the actual plan. Local
five-connection measurements are not a production pool-limit recommendation.

Google setup: retain `openid` plus `meetings.space.readonly`, offline refresh,
PKCE/state/nonce and ID-token validation. Existing connections lacking a verified
subject need reconnection. Confirm API enablement, consent publishing/test-user
access and exact redirect in Google Cloud. No additional Drive/recording scope.
The direct backend prepare request uses a Secure HttpOnly SameSite=None OAuth
cookie on HTTPS; verify credentialed CORS, CSP and cookie acceptance on real
frontend/backend origins, including browsers blocking third-party cookies. Do
not bypass nonce/state if deployment cookie behavior fails.

## Backup and rollback

Before release, identify the actual production provider and backup retention.
For Prisma Postgres, confirm Console snapshots/plan coverage and take a fresh
manual dump through direct access. Do not assume Render PostgreSQL backups cover
an external Prisma database. A daily snapshot alone can lose newer transactions.

Future operator example, using a protected libpq service/password configuration
(never credentials in command arguments or logs):

```sh
PGSERVICE=flowlytiks-production-backup pg_dump --format=custom --file=/secure-backups/flowlytiks-pre-release.dump
pg_restore --list /secure-backups/flowlytiks-pre-release.dump
```

Use a compatible PostgreSQL client (17 was used locally). Restore only into a
new isolated target for validation, never over the application database. Check
students/accounts, payments/gateway evidence, payroll/payout totals, rate
snapshots, conference deduplication, encrypted connections and migration ledger.
Encrypt and restrict backup access: it contains personal data, session/OTP state
and encrypted OAuth credentials. Retain the corresponding encryption key in a
separate protected secret backup.

Prefer a forward fix or a **tested compatible** code rollback while retaining
additive database structures. Test the previous artifact against the upgraded
schema and new rows: old code may not understand DAILY attendance or current
payout reservation/recovery states. Never assume a previous deploy is compatible.

Render rollback reuses the selected artifact and service environment settings;
environment groups can retain current values. Database contents are not a code
rollback. Record configuration versions and keep encryption keys consistent.
Check artifact retention and auto-deploy behavior before relying on rollback.

If data recovery is truly necessary, require explicit incident approval, stop
writers/workers, restore into a new database, validate, and reconcile every real
provider order/transfer since the backup using stable identifiers before switching
connections. Do not retry ambiguous transfers or create replacement cash payouts
blindly. Do not delete paid history, edit applied migrations or reset production.

## Release blockers / decisions

1. **Production migration ledger, schema and restorable fresh backup not verified.**
   Candidate list above is not permission to apply all pending migrations.
2. **Render dashboard evidence missing:** actual deployed revision/environment,
   canonical frontend, origins, service types/plans, instances, worker deployment,
   termination grace, auto-deploy settings and ingress header trust.
3. **Actual pooler compatibility/capacity and original Closed/P2024 unresolved.**
   Need sanitized incident telemetry plus a disposable endpoint through the
   production pooler type/mode; direct local tests are not that verification.
4. **Real provider staging checks pending:** Google consent/identity/cookies,
   Meet evidence, Cashfree checkout/webhook/payout signing and Resend delivery.
   Check PG API 2025-01-01 and payout API 2024-01-01 configuration against the
   current integration; keep pending/ambiguous transfer recovery intact.
5. **Payment-mode decision required:** the working configuration is temporary
   MANUAL_UPI, while Cashfree remains the provider integration. Select and align
   both services deliberately. UTR submission alone must never mark fees paid.
6. **Residual dependency risk needs disposition:** Phase 1 records Prisma-related
   dependency advisories and export-only XLSX 0.18.5 exposure. No untrusted XLSX
   import is used. Review/accept outstanding advisories rather than claim zero
   vulnerabilities or force a major upgrade during release preparation.
7. **Release artifact not finalized.** Preserve all working-tree changes, include
   required new files, review diff and repeat affected checks only if the release
   changes. No full production readiness is claimed from local phase results.

## Short post-deployment smoke checklist

Run first in staging with authorized test accounts and sandbox providers; do not
create real financial actions simply to satisfy a smoke test.

- Confirm revision, startup schema guard, root health and authenticated database
  queries; inspect sanitized errors and required configuration booleans.
- Login/reload/logout for all roles; role/ownership denials work. Transient 5xx
  and permission failures must not destroy a valid session.
- Verify Staff creation/reset OTP, single use, retained Admin session and Staff
  restrictions. Confirm real authorized email delivery without logging codes.
- Check monthly counts/receipts against the same fee month/session and valid
  records; verify approved payment mode, sandbox callback replay/idempotency and
  unchanged online-reversal restrictions.
- Check stored weekday/weekend attendance, Friday-Thursday totals/cutoff,
  overrides, paid locks and CSV/XLSX/PDF access/contents with controlled fixtures.
- Google connect/reconnect/return; multi-batch scheduling and real Live/ended
  evidence; teacher/participant verification and exactly-one incentive. Scheduled
  or missing data must not credit; protected deletion rules and PDFs remain scoped.
- Confirm faculty incentive balances/paid history and post-paid faculty emails;
  no student payment emails or duplicate payouts/credits.
- Monitor 5xx/latency, memory, connection waits/P2024, worker lease/backoff and
  webhook queues during and after load. Verify recovery after a controlled
  staging restart; keep production alerting and reconciliation ownership clear.

## Official references

- [Render deployment and pre-deploy behavior](https://render.com/docs/deploys)
- [Render rollback configuration behavior](https://render.com/docs/rollbacks)
- [Express proxy trust and forwarded-header safety](https://expressjs.com/en/guide/behind-proxies/)
- [Prisma Postgres direct and pooled connections](https://www.prisma.io/docs/postgres/database/connection-pooling)
- [Prisma Postgres backups](https://www.prisma.io/docs/postgres/database/backups)
- [Prisma 6 production migration workflow](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production)

These documents support the deployment recommendations, not confirmation of
dashboard settings or actual production infrastructure.
