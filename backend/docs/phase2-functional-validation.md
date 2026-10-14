# Phase 2 functional validation - 2026-10-13

## Verdict

BLOCKED for staging sign-off. The latest continuation below completes the three
requested local items: remaining checkout/dispatcher locks, browser-to-real-API
tests, and downloaded XLSX/report PDF assertions. Actual deployment pooler,
Render ingress and original remote Closed/P2024 evidence remain unavailable.
Passing isolated database and mocked-provider tests is not production readiness.

## Safety and isolation

- Used a new disposable PostgreSQL cluster under `/tmp/flowlytiks-phase2-pg`,
  listening only on localhost port 55439, database `flowlytiks_test_phase2`.
- Replayed all 46 existing migrations there. No application database connection,
  migration, reset, seed, payment, incentive or historical-record change occurred.
- The test guard requires explicit disposable acknowledgement, a local PostgreSQL
  target with a `flowlytiks_test_` name, and rejects the configured application
  target. It reads application configuration privately only to compare targets.
- Test HTTP servers mount real routes without importing `server.js`; background
  workers are not started. Resend and provider calls are mocked/blocked.
- Browser tests use a fresh Chrome profile, mocked API responses and an isolated
  server fetch shim. Initial browser startup exposed the existing CRM middleware
  status fetch, which made read-only external requests and received 429. That
  server was stopped; subsequent runs mocked this check. No real email, payment,
  payout or OAuth authorization was initiated.
- Existing dirty changes, including prior PhonePe removals, are preserved. No
  dependency, schema, environment-file or applied-migration edits were made here.

## Reproduced defect and fix

`frontend/app/student/page.jsx` cleared authentication for every profile/payment
loading error. A mocked HTTP 503 reproduced a redirect to Login and session loss.
It now clears only a genuine 401 for the matching current Student token, ignores
stale/cancelled loads, and shows a retryable error for other failures. Successful
fee calculations and payment UI are unchanged. The browser regression passes.

## Initial results and coverage

| Check | Result | Evidence / limits |
| --- | --- | --- |
| Non-PostgreSQL Node suite | 159 passed | Includes existing auth, payment, attendance, Google/Meet, history, security and incentive regressions; persistence/provider portions are mocked |
| Real PostgreSQL suite | 8 passed, no skips | Existing migration replay, real service transactions and real Express HTTP routes |
| Playwright | 3 passed | Four role selections/login routing, Student-only signup, Staff recovery transitions, session persistence, Google modal focus/scroll/Escape, compact multi-batch selector and responsive overflow |
| TypeScript | Passed | `tsc --noEmit --incremental false` |
| ESLint | 0 errors, 61 warnings | No autofix or broad suppression |
| Production build | Passed with Webpack | `npm run build -- --webpack`; default Turbopack failed on sandbox port binding, not a demonstrated application compilation error |
| Diff whitespace | Passed | `git diff --check` |

Real HTTP/PostgreSQL coverage includes invalid/valid Admin login, heartbeat/logout,
Staff creation with controlled leading-zero code, wrong/expired/reused codes,
resend invalidation, Staff login/reset/session revocation, role restrictions,
shared follow-up history, cash attribution, concurrent cash submission, real
dashboard aggregate comparisons, cash reversal/non-cash refusal, denied
Faculty/Staff Cashfree verification, absent PhonePe callback, weekday/weekend
attendance, amount rejection, repeated attendance, Admin override persistence and
CSV authorization/content.

Other real PostgreSQL tests exercise directory uniqueness/multi-batch relations,
legacy snapshots, summary counts, LIVE lifecycle constraints, copy-set snapshots
and payment locks, deletion tombstones, protected states and conference uniqueness.
Expected constraint errors in negative tests are not suite failures.

The rate-limit test uses two separate Node processes/pools and real middleware:
30 concurrent attempts accept exactly 7, reject 23, and persist 7 events. It also
checks independent keys, expired windows, insertion rollback and pool usability.
These particular attempts invoke middleware directly rather than through HTTP.

Database interruption tests deliberately exhaust a one-connection test pool to
produce bounded P2024, then recover after release; a separately controlled test
connection is terminated and recovers through bounded P1017 retry without revoking
stored sessions. This does NOT establish the cause or resolution of the original
remote PostgreSQL `Closed` errors or production heartbeat 500.

Browser API responses are fixtures, not a browser-to-PostgreSQL end-to-end test.
Widths exercised: 320, 341, 390 and 1440 pixels. Screenshots are stored under
`/tmp/flowlytiks-phase2-screenshots`. All-role complete signup/reset/payment flows,
parseable attendance/report PDF assertions, provider webhooks through real
HTTP/PostgreSQL, and full worker restart/exactly-once credit integration remain
coverage gaps. Existing mocked tests cover portions but cannot close those gaps.

## Render ingress: not verified

No Render Blueprint, Docker/reverse-proxy deployment configuration or documented
production header chain was found. Next.js rewrites `/api` using the configured
backend URL. Express currently uses `trust proxy = 1`; this was not changed.

[Render's documentation](https://render.com/docs/web-services) establishes its
TLS-terminating load balancer and protected service port, but does not establish
this application's complete forwarded chain. [Express documentation](https://expressjs.com/en/guide/behind-proxies/)
requires the setting to match the actual topology. No assumption was made about
Cloudflare or another intermediary.

Confirm in Render/DNS/frontend hosting configuration:

1. Backend service/custom domains, frontend rewrite destination and any CDN.
2. All public/private request paths, including direct onrender.com access.
3. Sanitized peer address and forwarded-header shape from each path; whether the
   final ingress overwrites attacker-supplied forwarding headers.
4. Trusted proxy addresses/ranges or proven consistent hop topology; verify
   `req.ip` and rate keys with spoofed headers before changing configuration.
5. Instance count, worker settings and an always-on plan for continuous Meet
   polling; a sleeping web service cannot provide continuous polling.

## Residual code/configuration review

The separate `backend/utils/dbLocks.js` helper uses session-level advisory lock
and unlock calls through pooled Prisma queries, without an explicit pinned
connection. This is a residual correctness concern for its payment/background
job callers, distinct from the tested transaction-scoped rate limiter. PostgreSQL
documents [session-level lock ownership and reentrancy](https://www.postgresql.org/docs/current/explicit-locking.html).
A safe connection-affine design needs a focused concurrency regression before
changing these callers; no speculative payment refactor was made in this phase.

Provider/pooler requirements and actual production connection counts remain
unverified. No connection limits/timeouts were raised and no normal-request
disconnect loop was introduced.

## Lint and dependencies

Warnings: 46 internal `location` navigation, 10 unused variables, 4 effect
dependencies, 1 native image. These patterns existed before this phase; no new
lint error was introduced. Full-page navigation can be intentional around auth,
so it was not indiscriminately replaced. Warning cleanup needs per-callsite
behavior evidence, not broad suppression.

Read-only full audits: backend 7 high; frontend 14 high, 1 moderate, 1 low;
zero critical. Runtime-only audits: backend 4 high in Prisma/config's dependency
chain; frontend 1 high in XLSX. Counts include transitive affected packages, not
that many distinct demonstrated exploits.

XLSX is used for output generation, not untrusted spreadsheet input. The registry
offers no fixed XLSX package version in the installed package line. Prisma's
flagged merge/RPC dependencies are tooling/config paths, not demonstrated exposed
application endpoints. Other full-audit entries are lint/build/watch tooling.
No compatible update with evidenced application benefit was established here;
no forced major upgrade, override or lockfile change was made.

## Files changed in the initial pass

Production: `frontend/app/student/page.jsx` only.

New backend tests/helpers: `disposableDatabase.js`, `disposableDatabase.test.js`,
`setupDisposableDatabase.js`, `seedDisposableDatabase.js`, `runPostgres.js`,
`functional.postgres.test.js`, `rateLimit.postgres.test.js`, `rateLimitProcess.js`,
`databaseRecovery.postgres.test.js` (all under `backend/tests`).

Existing PostgreSQL tests extended with target guards:
`adminOnlineClass.postgres.test.js`, `incentiveCopySets.postgres.test.js`,
`meetStatus.postgres.test.js`, `onlineClassDeletion.postgres.test.js`.

New frontend tests: `frontend/tests/phase2.browser.mjs` and
`frontend/tests/isolateServerNetwork.mjs`. This report is also new.

## Re-running safely

From `backend`, after provisioning an explicitly disposable local PostgreSQL DB:

```sh
TEST_DATABASE_URL='<disposable local test URL>' FLOWLYTIKS_DISPOSABLE_DATABASE=true node tests/runPostgres.js
```

The runner applies existing migrations ONLY to the guarded disposable target and
creates isolated fixtures. Never substitute the application DATABASE_URL.
Browser tests require an installed Playwright module/Chromium, a local production
frontend started with `FLOWLYTIKS_BROWSER_ISOLATED=true` and
`NODE_OPTIONS='--import ./tests/isolateServerNetwork.mjs'`, then
`node --test tests/phase2.browser.mjs`. The external bundled Playwright path used
for this validation does not add a project dependency.

No commit, push or deployment was performed. Temporary test servers/cluster are
stopped after validation; the disposable files remain available for inspection.

## Continuation - outstanding items (2026-10-13)

Verdict remains **BLOCKED**. This continuation did not restart the audit or rerun
the completed browser suite. No application database, schema, dependency,
environment, authentication, UI, attendance or incentive calculation was changed.

| Outstanding item | Status | New evidence / remaining requirement |
| --- | --- | --- |
| Render ingress/IP | Blocked | Real local HTTP checks cover direct requests, explicit trusted chains, forged leading headers and one-hop spoofing. Actual Render/frontend/CDN forwarding behavior remains unknown; trust proxy is unchanged. |
| Cashfree finalization lock | Fixed | Repeated real-route verification reproduced a null lock result/HTTP 500. Finalization now acquires a transaction-scoped advisory lock on its existing write transaction. Provider fetches remain outside that transaction. |
| Other legacy advisory callers | Unresolved, confirmed defect | One-connection test proves reentrant overlap; two-connection test proves unlock leakage. Checkout, scheduler and background-job callers still use the legacy helper. These diagnostic assertions document defects, not successful mutual exclusion. |
| Rate limiter | Verified on direct PostgreSQL | Two separate processes now send 30 real HTTP requests: 7 accepted, 23 rejected. Independent keys, expiry and rollback remain covered. No limit/window changes. |
| Pooler compatibility | Blocked | PgBouncer is not installed and no representative deployed pooler configuration was supplied. Direct PostgreSQL results are not pooler verification. |
| Cashfree payment integrity | Fixed / verified with mocked provider | SUCCESS for amount 1 against a saved amount 600 was incorrectly accepted before the fix. Saved order ID, amount and currency, plus successful payment amount/currency/reference, are validated before any reconciliation write. Mismatches return 502 and retain fee status. A separate reproduced stale ACTIVE snapshot downgraded the gateway; confirmed PAID state is now retained under the transaction lock. |
| Cashfree replay/ownership | Verified with real routes/PostgreSQL, mocked provider | Missing auth and foreign ownership denied before provider access; bad signatures rejected; untrusted success body remains unpaid; pending and concurrent success/replays preserve one payment attempt and paidAt. |
| Attendance cutoff/paid locks | Verified with real PostgreSQL and controlled server clock | Previous week accepts at noon minus 1ms, rejects at noon, Admin edits time-locked unpaid entries, settled record blocks Admin too, and new Friday remains independently editable. Weekend 400, weekday 200 and stored override 375 retained. |
| Copy sets / payout and deletion races | Verified on direct PostgreSQL | Existing affected transaction suites rerun: snapshots, totals, owner checks, payment lock and class deletion/verification races pass. |
| Meet exactly-once / multi-batch | Verified on direct PostgreSQL, mocked Google | Concurrent worker/manual service checks complete one two-batch class with one incentive at stored configured rate 237. Participant/session pagination and overlapping reconnect durations persist correctly; repeated polling does not credit twice. |
| Admin/Faculty consistency | Verified with real routes/PostgreSQL | Both history endpoints return the same completed class and two batch names; either batch filter yields one class. Both roles reject deletion of the completed session. |
| Attendance PDF | Verified with real route/PostgreSQL | Owner/Admin get application/pdf, attachment, private/no-store and parseable nonempty PDFs. pypdf verifies topic, teacher, both batches, participants, IST and duration. Anonymous, foreign Faculty, Student and Staff rejected. This is content/authorization validation, not a new PDF visual redesign. |
| Original remote connection closures | Unresolved | No original runtime trace/provider logs were available. Shared Prisma client and bounded read/session retry remain intact; Meet shutdown waits for active work before disconnect. No limit/timeout increases or per-request disconnect changes. |
| Build isolation | Fixed test setup | New helper copies source (excluding envs, node_modules and .next output) to a generated temporary directory, links installed dependencies, mocks external server requests and runs Webpack build/type-check there. Active dev artifacts/servers remain untouched. |
| Advisories/lint | Reviewed, unresolved where already documented | Installed pinned versions/usage unchanged; no forced upgrade or warning suppression. New frontend test helper passes targeted lint. |

### Why the generic lock is not yet replaced

The existing helper acquires/releases session locks using separate pool queries.
In the one-connection diagnostic, a second call acquires the same lock reentrantly
and enters while the first callback is still active. In the two-connection
diagnostic, a transaction occupies the acquiring connection, the unlock runs on
another connection, and the original lock remains in `pg_locks` after return.

Cashfree finalization can safely use its existing short transaction, so that
caller was fixed. The remaining callbacks include external provider/notification
work and independent/nested transactions. Wrapping them blindly in an interactive
transaction would hold pool connections during network calls, risk timeouts and
change failure semantics. A dedicated session connection alone would still be
unsafe through transaction pooling. The smallest safe remaining fix needs a
fenced claim/design specific to those callers, with provider idempotency and
crash recovery tests. This is a confirmed blocker, not deferred cosmetic cleanup.
[PgBouncer explicitly excludes session advisory locks from transaction pooling](https://www.pgbouncer.org/features.html).
No claim is made that the generic helper or original production closures are fixed.

The transaction-lock control test verifies a stable backend PID within the
transaction, rollback release, reacquisition, and a bounded 100ms test-only lock
timeout. Production rate-limit transaction bounds remain maxWait 5s / timeout
10s. No external calls occur inside rate-limit or finalization transactions.

### New payment validation evidence

Before editing, the actual Express verification route returned 200/PAID for a
mocked successful attempt of amount 1 on an order of amount 600, and persisted
paid status in the disposable database. The new test now receives 502 and proves
the record stays created. Wrong order ID, currency and order amount also fail.
Valid success still marks the existing fee record paid; simultaneous checks and
webhooks do not duplicate attempts or change paidAt after the initial transition.
An ACTIVE/empty-attempt snapshot fetched before another success must now return
the persisted PAID outcome instead of changing the gateway back to INITIATED.
Cashfree signature/ownership checks and checkout integration are not replaced.
Validation fields follow [Get Order](https://www.cashfree.com/docs/api-reference/payments/latest/orders/get-order)
and [Get Payments for an Order](https://www.cashfree.com/docs/api-reference/payments/latest/payments/get-payments-for-an-order).

### Validation commands/results for this continuation

- Affected mock/session/proxy suite: **22 passed**, no failures.
- Affected PostgreSQL suite: **9 passed**, no skips (includes two explicit
  diagnostics proving the unresolved legacy lock defects).
- Isolated production build: passed, including TypeScript, all 38 static pages.
- Targeted frontend lint: `eslint tests/buildIsolated.mjs`, passed.
- Backend syntax check and `git diff --check`: passed.
- Prior browser results remain applicable; no production frontend/UI change was
  made and they were not needlessly rerun.

The new PostgreSQL tests require existing disposable migrations/seed fixtures and
the original fail-closed preload; no migrate command was run in this continuation.
Example (from backend, using ONLY the disposable test target):

```sh
TEST_DATABASE_URL='<disposable local test URL>' FLOWLYTIKS_DISPOSABLE_DATABASE=true \
RUN_PHASE2_POSTGRES_TESTS=true RUN_COPY_SET_POSTGRES_TESTS=true RUN_ONLINE_DELETE_POSTGRES_TESTS=true \
TEST_PDF_PYTHON='<Python with pypdf>' \
node --import ./tests/setupDisposableDatabase.js --test --test-concurrency=1 \
tests/advisoryLock.postgres.test.js tests/attendanceBoundaries.postgres.test.js \
tests/meetPipeline.postgres.test.js tests/paymentIntegrity.postgres.test.js \
tests/rateLimit.postgres.test.js tests/incentiveCopySets.postgres.test.js \
tests/onlineClassDeletion.postgres.test.js
```

Build without changing dev output: `node tests/buildIsolated.mjs` from frontend.
The disposable PostgreSQL service started here is stopped; the user servers were
not stopped. Temporary build files created here are removed after validation.

### Changed files and necessity

- `backend/controllers/cashfreecontroller.js`: transaction-affine finalization
  lock, evidence validation before writes and protection against stale PAID
  downgrades.
- `backend/services/cashfreeService.js`: narrow saved-order/evidence validator.
- `backend/tests/paymentAuthorization.test.js`: existing mock now supplies the
  documented provider order fields required by the new validation.
- `backend/tests/paymentIntegrity.postgres.test.js`: real route/provider-evidence,
  replay/concurrency/ownership regression.
- `backend/tests/advisoryLock.postgres.test.js`: confirmed leakage/reentrancy
  diagnostics plus transaction rollback/timeout control.
- `backend/tests/attendanceBoundaries.postgres.test.js`: real cutoff/paid-lock
  persistence coverage.
- `backend/tests/meetPipeline.postgres.test.js`: persisted mocked-Google pipeline,
  exactly-once, multi-batch consistency and protected parseable PDF coverage.
- `backend/tests/proxyTopology.test.js`: real local HTTP proxy-header behavior.
- `backend/tests/rateLimitProcess.js`: exercises real HTTP rather than direct
  middleware invocation in the existing separate-process rate test.
- `frontend/tests/buildIsolated.mjs`: test-only copied-source build isolation.
- This report: updated evidence/status and exact remaining gaps.

No schema/migration, package/lockfile, environment or unrelated UI edit was made.
Existing earlier dirty edits/deletions are preserved, not introduced here.

### Outstanding advisories and precise remaining gaps

Prisma CLI/Client remain 6.19.2, deepmerge-ts 7.1.5 and effect 3.18.4. The
[deepmerge maintainer advisory](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx)
requires 8.x and recursive object graphs (ordinary JSON alone is insufficient).
No attacker-controlled config graph or exposed Effect RPC path was found.
XLSX remains 0.18.5, used only at the Work Ledger `XLSX.writeFile` export; there
is no workbook import. No speculative major override/distribution replacement.
Build/watch/lint advisories remain tooling risks: use trusted source/config and
do not deploy watch processes. Earlier audit counts were not presented as a new
audit or as proof that every advisory is exploitable.

Before READY FOR STAGING:

1. Fix the remaining generic session-lock callers with crash-safe concurrency
   tests; verify against the actual pooler mode/version/connection requirements.
2. Supply the Render/Next/CDN ingress evidence listed above and test attacker
   forwarding headers on each deployed path. Local one-hop tests demonstrate the
   risk but do not prove Render accepts spoofed headers.
3. Obtain sanitized original heartbeat/P2024/Closed traces, DB/pooler termination
   logs and Render restart timestamps; correlate process count and active/query
   connections at failure. Diagnose that event, not merely local fault injection.
4. Remaining coverage: full browser-to-real-test-API signup/reset/payment flows
   for all roles, broader filtered CSV/XLSX/report PDF contents, and a full worker
   process restart/crash scenario (current new test exercises persisted service
   polling resumption, not OS-level worker restart). Google/OAuth and providers
   remain mocked; live provider staging checks need a separately authorized plan.

No real email/payment/payout/OAuth action, application data write, commit, push or
deployment occurred in this continuation. Production readiness is not claimed.

## Remaining-blocker continuation - 13 October 2026

**Verdict: BLOCKED.** This continuation fixes the three database-only scheduler
lock callers and a reproduced jobs-process shutdown race. It does not certify
the remaining network-bearing session-lock callers or the deployment topology.
Earlier completed results above remain historical evidence, not newly repeated
checks or proof of actual pooler behavior.

| Item | Status | Evidence / remaining requirement |
| --- | --- | --- |
| Promotion, reminder queueing, auth maintenance locks | FIXED, VERIFIED on isolated direct PostgreSQL | New transaction-bound try-lock passes its transaction client to every protected helper; locks end at commit/rollback, without network calls. Separate processes admit exactly 7 of 30 protected budget operations; one-connection queue/rollback/repeat test passes. |
| Remaining legacy session locks | UNRESOLVED | Exactly two production callers remain: `createCashfreeHostedOrder` in `controllers/cashfreecontroller.js` and `processPendingBackgroundJobs` in `services/backgroundJobService.js`. Their callbacks include provider calls/job execution. Existing leakage/reentrancy diagnostics remain applicable. A safe fix must separate persisted reservation/claim from external execution and finalization; merely wrapping either callback in a long transaction is not a fix. This is outstanding implementation work, not an infrastructure-only blocker. |
| Background jobs shutdown | FIXED, VERIFIED with controlled dispatcher | Regression failed before fix because stop returned undefined while dispatch was active. Worker stop now awaits its active iteration, and `jobs.js` awaits stop before Prisma disconnect. This does not establish the cause of the original remote Closed/P2024 incident. Cron callback draining and a forced shutdown deadline are not covered by this test. |
| Meet worker OS process crash/restart | VERIFIED with real PostgreSQL and mocked Google | Child running the actual worker lifecycle is killed after conference evidence persists. Restart cannot steal the unexpired lease. Injected clock advances beyond persisted lease expiry; another process verifies the same conference and credits exactly one entry at the stored configured rate. Repeated restart does not credit again. No production lease duration changed. |
| Selected-week CSV/JSON exports | VERIFIED through real HTTP/Prisma | Admin exports include both stored override and legacy amount, exclude next-week entry, ignore stale search/shift/limit parameters when a week is selected, retain week dates/totals. Unauthenticated requests return 401; Faculty/Staff/Student return 403. Browser-generated XLSX and work-ledger PDF contents still need end-to-end coverage. |
| Actual / representative pooler | BLOCKED by missing infrastructure access | Private URL metadata identifies a remote target but not a known provider suffix or pooler mode; only `sslmode` query option is present, no configured DIRECT_URL. Absence of a pooler marker does not prove direct connectivity. PgBouncer binary unavailable; Docker client installed but daemon socket absent. No pooler was started or tested. |
| Render ingress | BLOCKED by missing deployment evidence | No Render Blueprint/reverse-proxy manifest found. Next rewrites relative `/api` to configured backend; Express still trusts one hop. Existing real local direct/trusted/spoofed-header tests pass, but cannot establish deployed header rewriting or all ingress paths. Configuration deliberately unchanged. |
| Original remote Closed/P2024 | UNRESOLVED | Existing bounded single-pool contention and terminated-connection tests rerun successfully after session-helper changes; valid sessions remain stored and usable. Original logs/provider termination evidence unavailable. No pool limit/timeout increase. |
| Browser-to-real-API flows across all roles | UNRESOLVED coverage gap | Existing real HTTP/Prisma Staff creation/reset, all-role sessions, follow-ups, cash concurrency, reversal protection, daily attendance and summaries rerun successfully. This is not browser-to-real-API signup/reset/payment validation for all roles. |

### Deployment evidence still needed

- Database provider name; actual direct/pooled endpoint classification, pooler
  product/version/mode, prepared-statement settings and TLS requirements. Supply
  an isolated disposable endpoint through the same pooler for concurrent tests;
  do not send credentials in chat or substitute the application database.
- Render service type/public and custom domains, frontend hosting/API rewrite
  destination, CDN presence, direct/private ingress paths, and sanitized socket
  peer plus forwarded-header chain for each path. Confirm whether ingress
  overwrites client-supplied forwarded headers before choosing trusted ranges or
  a proven hop count. Also confirm instance count and always-on worker settings.
- Sanitized original failure stack, provider/pooler termination logs, Render
  restart timestamps and concurrent process/connection counts at the incident.

[PgBouncer's feature table](https://www.pgbouncer.org/features.html) explicitly
excludes session advisory locks from transaction pooling. The
[Prisma v6 pooler guidance](https://www.prisma.io/docs/orm/v6/prisma-client/setup-and-configuration/databases-connections/pgbouncer)
requires checking transaction mode and version-specific prepared-statement
configuration; no connection-string flag was added without knowing the provider.
[Express](https://expressjs.com/en/guide/behind-proxies/) requires topology-aware
trust and warns about different-length paths. [Render web-service documentation](https://render.com/docs/web-services)
does not establish this project's complete CDN/Next/proxy chain.

### Changed files in this continuation

- `utils/dbLocks.js`: add short transaction-bound lock helper; legacy helper
  retained only for the two explicitly unresolved callers above.
- `services/scheduler.js`: migrate its three callbacks to the transaction helper.
- `services/backgroundJobService.js`: optional transaction client for queueing;
  await active dispatcher during stop, without changing job business logic.
- `services/promotionService.js`, `services/emailOtpService.js`,
  `utils/sessionStore.js`, `middleware/security.js`: optional database client in
  only the protected lookup/maintenance functions; existing defaults unchanged.
- `jobs.js`: await background-worker drain before disconnect on both signals.
- `tests/schedulerLocks.postgres.test.js`, `tests/transactionLockProcess.js`:
  separate-process budget, one-connection affinity, queue dedupe and rollback.
- `tests/backgroundWorkerShutdown.test.js`: reproduced-before/fixed-after drain.
- `tests/meetRestart.postgres.test.js`, `tests/meetRestartProcess.js`: isolated
  process crash, retained evidence, lease expiry, retry and exactly-once recovery.
- `tests/ledgerExport.postgres.test.js`: real role-protected selected-week exports.
- This report: explicit fixed/verified/blocked/unresolved status and requirements.

### Commands and results

- Guarded PostgreSQL tests: `schedulerLocks.postgres.test.js`,
  `rateLimit.postgres.test.js`, `meetRestart.postgres.test.js`,
  `ledgerExport.postgres.test.js`, `databaseRecovery.postgres.test.js`,
  `functional.postgres.test.js`: **8 passed, no skips/failures**. Only the existing
  disposable cluster on port 55439 was used; no migration command was run.
- Mock/local-HTTP regressions: `sessionFailure.test.js`,
  `securityHardening.test.js`, `proxyTopology.test.js`,
  `workLedgerAttendance.test.js`: **20 passed**. Initial sandbox EPERM prevented
  the proxy listener; rerun with local-binding approval passed, no code workaround.
- `backgroundWorkerShutdown.test.js`: **1 passed** after the evidenced fix.
- `node --check` on all 14 changed JavaScript files: passed.
- Frontend `node tests/buildIsolated.mjs`: production Webpack build and TypeScript
  passed, 38 static pages; temporary copied source removed, active `.next` untouched.
- Frontend `npx eslint tests/buildIsolated.mjs`: passed. No frontend source changed;
  earlier 61 warnings remain reported above, not suppressed or newly resolved.
- `git diff --check`: passed; changes reviewed for scope and secret disclosure.

No schema, migration, dependency, environment or frontend application file changed
in this continuation. No application/production connection or write, real provider
action, commit, push or deploy. Existing user edits and prior authorized deletions
remain preserved. The temporary PostgreSQL process started for these tests is
stopped afterward; the user's development servers are untouched.

Before READY FOR STAGING, finish the two network-bearing lock callers, actual
pooler/ingress verification, incident diagnostics and the precise browser/XLSX/PDF
coverage gaps above. Do not treat the passing local tests as full production
readiness.

## Checkout, dispatcher and real-browser continuation - 13 October 2026

This section supersedes the earlier **outstanding local lock/browser/export**
statuses; previous results are retained as dated history, not discarded.

**Verdict: BLOCKED. All three requested locally actionable items completed.**

| Item | Current status | Concrete evidence |
| --- | --- | --- |
| Cashfree checkout legacy lock | FIXED / VERIFIED | Short transaction-affine reservation writes a persisted claim into existing gateway metadata. Provider requests occur after commit with a 30-second request bound. Finalization is another short transaction, fenced by the existing verification/webhook lock. A late checkout response cannot downgrade paid state. Retries recover the same order ID/idempotency key after an uncertain response; active claims return 409 and reusable sessions retain existing behavior. No migration. |
| Background dispatch legacy lock | FIXED / VERIFIED | Stale recovery, pending selection and conditional claim execute on the lock-owning transaction client. RUNNING plus startedAt/heartbeat is the persisted claim; only one valid dispatcher executes. Job/network work occurs outside the transaction. Heartbeats are non-overlapping; progress/result/failure writes and per-student continuation checks are claim-fenced. A stale worker cannot finish a replacement claim. Previous shutdown draining remains intact. |
| Legacy helper removal | VERIFIED | No production imports or session-advisory-lock calls remain. Historical leakage/reentrancy reproduction is now local to the guarded test file only. Transaction helper and scheduler fixes are preserved. |
| Browser to real API/PostgreSQL | VERIFIED | Headless Chrome uses a copied production Next build, its real relative /api rewrite, actual Express routers, actual session middleware and guarded PostgreSQL. No internal browser API response is mocked. All four password logins, reload/heartbeat, logout/revocation, all-role password resets, Student signup, Staff creation/single-use verification and Staff cash recording pass. Old passwords fail after reset; Admin session survives Staff creation. |
| Cashfree from browser | VERIFIED with provider mock | Browser fetch reaches real checkout/verify endpoints and database. Pending provider evidence remains INITIATED; authoritative mocked success becomes PAID; replay remains paid; Staff verification is rejected. This is not Cashfree SDK/checkout UX or a real transfer. |
| Work Ledger XLSX/PDF | VERIFIED actual downloaded files | Browser clicks existing export controls for the previous selected week. XLSX is parsed into all three sheets: full entries, faculty totals and week/day totals. Stored override 375 and legacy 123 are present, following-week 999 is absent, row count matches full real API response, and faculty/weekly sums match actual amounts. PDF is parsed with pypdf and includes week, both entries/amounts and matching weekly total; following-week remark is absent. CSV/JSON real-route tests separately verify complete-week behavior and 401/403 authorization. |
| Staff filtered PDF | VERIFIED actual downloaded file | Existing UI applies search, class, fee month, session and paid status, then calls the real export API. One matching cash-paid student appears; the other-class student is excluded. PDF includes matching count, name, month/session and Paid. Admin/Faculty/Student are denied the Staff export endpoint; only Staff may export. |

### Why the lock changes were necessary

The retired helper acquired and released session locks using independent pooled
queries. Separate acquisition/work/release could use different connections;
reentrant session locks also allowed overlapping work on a reused connection.
Wrapping provider calls/job execution in an interactive transaction would keep
the connection occupied and was not used. Reservations and renewable claims
instead use existing records, with network execution outside database locks.

Checkout completion also takes `cashfree:finalize:<order>` before reading paid
state, sharing the already-existing webhook/verification fence. Real PostgreSQL
holds a competing finalization open, commits PAID, then permits the delayed
checkout finalizer: the finalizer returns alreadyPaid and preserves PAID.

Queue claims prevent duplicate simultaneous execution and stale completion.
They do **not** promise exactly-once arbitrary external delivery after a process
crashes between provider acceptance and its progress write. Existing payment
idempotency remains in place; reminder delivery retains its established retry
semantics. No new external-message architecture or real message was introduced.

### Files changed in this continuation

- `controllers/cashfreecontroller.js`: reserve/network/finalize checkout; remove
  obsolete private checkout lookup/order-ID helpers; release claim on URL/config
  or provider failure without minting a new order.
- `services/cashfreeCheckoutService.js` (new): persisted reservation, recovery,
  lease ownership and paid-state fence, using existing schema.
- `services/cashfreeService.js`: optional AbortSignal for checkout provider calls;
  existing callers' defaults unchanged.
- `services/backgroundJobService.js`: transaction-bound dispatch claim and stale
  recovery, renewal, fenced progress/completion/failure and per-student checks.
- `services/reminderservice.js`: optional pre-student claim check only; ordinary
  reminder callers remain unchanged.
- `utils/dbLocks.js`: remove the now-unused unsafe production helper; retain the
  completed transaction helper.
- `tests/remainingLocks.postgres.test.js`, `tests/remainingLockProcess.js` (new):
  separate-process claims, repeats, expired ownership, rollback and paid race.
- `tests/checkoutRoutes.postgres.test.js` (new): real authenticated HTTP checkout,
  concurrent request, lost provider response recovery and no idle transaction
  during provider access.
- `tests/advisoryLock.postgres.test.js`: keep removed-pattern diagnostic locally
  rather than exporting it from application code.
- `tests/backgroundWorkerShutdown.test.js`: mock supports the transaction-bound
  dispatcher while preserving the previous shutdown regression.
- `tests/ledgerExport.postgres.test.js`: choose an unused disposable fixture week
  on reruns; do not confuse retained test fixtures with application export bugs.
- `tests/browserApiServer.js` (new): guarded real API/test records and mocked
  Resend/Cashfree boundaries, without production worker startup.
- `../frontend/tests/phase2RealApi.mjs` (new): copied build, real browser/API flows,
  downloaded XLSX/PDF content assertions and temporary-server cleanup.
- This report: current outcomes, exact limitations and infrastructure evidence.

No frontend application/UI, schema, migration, dependency, environment or
deployment file was changed by this continuation. Pre-existing edits and the
previously authorized PhonePe deletions remain preserved.

### Validation executed

- Guarded real PostgreSQL regression command, from backend:
  `node --import ./tests/setupDisposableDatabase.js --test --test-concurrency=1
  tests/remainingLocks.postgres.test.js tests/checkoutRoutes.postgres.test.js
  tests/schedulerLocks.postgres.test.js tests/paymentIntegrity.postgres.test.js
  tests/functional.postgres.test.js tests/ledgerExport.postgres.test.js`:
  **8 passed, 0 failed/skipped**. Explicit TEST_DATABASE_URL,
  FLOWLYTIKS_DISPOSABLE_DATABASE=true and RUN_PHASE2_POSTGRES_TESTS=true required.
- Earlier focused run including `advisoryLock.postgres.test.js`: **8 passed**;
  its two legacy diagnostics deliberately reproduce the retired pattern and are
  not actual pooler validation.
- Mock/local regressions: `paymentAuthorization.test.js`,
  `backgroundWorkerShutdown.test.js`, `sessionFailure.test.js`,
  `securityHardening.test.js`, `staffPasswordReset.test.js`, `staffAuth.test.js`:
  **51 passed, 0 failed** including nested cases.
- `node tests/phase2RealApi.mjs`, from frontend: **passed all listed scenarios**.
  Requires the guarded disposable URL, explicit acknowledgement, installed
  Playwright module/Chrome paths and TEST_PDF_PYTHON with pypdf. The script builds
  and starts its own temporary copy, uses an ephemeral port and removes it on
  completion. Resend/Cashfree alone are mocked; no real emails or transfers.
- Isolated Next production Webpack build and TypeScript: **passed**, 38 static
  pages. Active development `.next` output was not touched.
- `npx --no-install eslint tests/phase2RealApi.mjs`: **passed**, no suppression.
  Earlier application warnings are unchanged; no broad warning cleanup.
- `node --check`: **passed** for all 13 changed backend JavaScript files.
- `git diff --check`: **passed**. No secret values included in this report.

Initial test-only failures were corrected, not hidden: the real checkout fixture
omitted its required amount field; a Staff class selector matched label text
incorrectly; Student recovery selected a hidden signup password input; the old
fixed export week contained retained disposable fixtures. Final runs above pass.

### Exact remaining blockers and coverage limits

1. **Actual pooler: BLOCKED by infrastructure access.** Need provider name,
   direct/pooled endpoint classification, pooler product/version/mode, prepared
   statement and TLS settings, plus a separately provisioned disposable endpoint
   through that pooler. Only direct local PostgreSQL was tested; neither actual
   nor representative PgBouncer verification is claimed. Existing availability
   limits (no PgBouncer binary/working Docker daemon) remain as documented above.
2. **Render ingress: BLOCKED by dashboard evidence.** Need frontend hosting and
   rewrite destination, public/custom/private Express ingress paths, CDN/proxy
   presence, sanitized socket peer/forwarded chain for each path and proof ingress
   overwrites forged headers. Instance count/worker always-on settings also need
   confirmation. No guessed trust-proxy setting was changed.
3. **Original remote Closed/P2024: UNRESOLVED.** Need sanitized incident stacks,
   DB/provider/pooler termination logs, Render restart times, process/connection
   counts and transaction/query duration at the failure. Existing local bounded
   recovery tests are evidence of recovery behavior, not its original cause.
4. **Remaining staging/coverage limits:** no real Google authorization/API,
   Cashfree hosted SDK checkout/transfer, Resend delivery, deployment ingress or
   pooler validation. Student OTP-login/2FA and browser-driven online-class
   lifecycle/attendance/payout races are not covered by the new real-browser
   suite; earlier mocked-browser and real HTTP/PostgreSQL tests remain separately
   identified, not relabelled end-to-end coverage. No public signup is applicable
   to Admin/Faculty/Staff; existing authorized Staff creation was tested instead.

No application database access/write or migration command was performed. Only
explicitly guarded disposable records were written. Temporary test services are
stopped after validation; running user servers remain untouched. No real provider
action, commit, push or deployment. Phase 2 is not marked passed.
