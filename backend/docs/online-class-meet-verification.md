# Verified Online Doubt Classes

The backend server starts the Meet worker after database initialization. Keep a
persistent Node process running; a sleeping/serverless process cannot poll. No
dashboard needs to be open. `ENABLE_MEET_POLLING=false` disables this worker for
maintenance/tests; default is enabled. No recording, Drive or Workspace Events
access is used. Google authorization remains Meet read-only with offline refresh.

## Setup

Review `20261011150000_verify_online_meet_attendance/migration.sql`. It adds only
tracking/evidence/lease fields, an account API cooldown and indexes. It was applied
to the confirmed development database. Legacy classes default to untracked and
are never automatically credited. Keep the existing encryption key unchanged.

For another explicitly confirmed target, inspect every pending migration first:

```sh
cd backend
npx prisma migrate status
# Apply only after reviewing the target and every pending SQL file:
npx prisma migrate deploy
npx prisma generate
npm run dev
```

No new credentials are required. Existing Google connection configuration and
Meet API enablement still apply. Production migration/deployment was not performed.

`20261012010000_allow_live_online_class_status` is a forward constraint correction
applied to the confirmed development database. It replaces the original status
check atomically with SCHEDULED, LIVE, COMPLETED and CANCELLED; verificationStatus
is separate. It does not modify existing records or previously applied migrations.
Run the real rollback-only PostgreSQL regression on a confirmed development target:

```sh
RUN_MEET_POSTGRES_TESTS=true node --test tests/meetStatus.postgres.test.js
```

The server logs `server.jobs_configuration` for disabled general jobs versus Meet
polling. The Meet worker separately logs started/disabled, processes one class at
a time and drains active work on shutdown. SIGINT/SIGTERM/nodemon SIGUSR2 stop new
work and close Prisma; a 15-second shutdown deadline leaves any interrupted lease
to expire normally. This does not enable the separate general jobs process.
Google refresh requests share a per-faculty in-process flight, perform no network
I/O inside DB transactions, and conditionally persist against unchanged connection
credentials so disconnect/reconnect cannot be overwritten. No connection limits
or pool timeouts are increased. Database errors are DATABASE_ERROR/DATABASE_BUSY,
not Google API errors. Sanitized logs contain category/name/code/SQLSTATE only;
evidence is retained and lease release always compares the owning lease token.

## Verification and recovery

New classes match the canonical saved Meet link and actual conference start in
a bounded interval: scheduled start minus 15 minutes (inclusive), through
scheduled end plus 15 minutes (exclusive). The same bounds apply to Google's
query and local matching. No end-time filter excludes ongoing calls. This
tolerance accommodates early joins/late starts, not old calls on reused links.
Ambiguous conferences or overlapping duplicate classes, including tolerance
overlaps, require review.
The exact conference resource is globally unique in the class table.

Google's actual end time, complete paginated attendance and reliably identified
teacher plus a different signed-in participant are required for credit. OAuth
token metadata is checked against the configured OAuth client and Meet scope;
only its Google user ID can identify the teacher. If Google does not provide this
ID, or only anonymous/phone peers are available, evidence remains for review.
Display names never establish identity. No minimum duration is imposed beyond
positive verified attendance. Participants are not assumed to be registered students.

The worker checks every 30 seconds, up to ten due classes sequentially. Database
leases prevent concurrent checks across processes and expire after ten minutes
following a crash. Progress extends the lease. Live evidence retries after one
minute; temporarily missing Google records also retry after one minute with a
neutral pending message, not a completion or failure. Checks during cooldown or
an existing worker return a pending result rather than HTTP 409. Ended review
states retry after one hour. API failures back off up to one
hour; rate-limit cooldown is shared by the Google account. Missing evidence never
means cancellation/completion. Candidate and partial participant/session evidence
is persisted after each page, retaining earlier evidence on failures. Google
conference evidence can expire, so keep the backend running promptly after calls.

Class completion and one existing incentive-ledger entry are created in one
transaction at the current configured rate snapshot. Cancellation and completion
lock the same class row. Credited classes cannot be cancelled through Faculty
controls; use the existing Admin correction workflow. Legacy entries/payments
are unchanged. There is no new automatic review-approval mechanism.

Faculty's Check Meeting Status invokes the same verifier; manual completion is
blocked. Existing manual count adjustments remain blocked for this incentive.
The PDF endpoint `/api/faculty-extra-incentives/online-classes/:id/attendance.pdf`
requires Admin or the owning Faculty and uses persisted complete Google evidence.
Review reports are clearly labelled and do not prove incentive eligibility.

## Real end-to-end test (not yet performed)

1. Connect the faculty Google account using the existing dashboard control.
2. Schedule a new ONLINE DOUBT CLASS before it starts, with a valid Meet link and
   accurate IST start/end window. Saving/copying its announcement must not credit.
3. Join with that exact connected Google account and a second signed-in account.
   Reconnect one participant to exercise session merging. Close the dashboard.
4. Observe Live while the conference is active. Teacher departure alone must not
   complete it. End the conference for everyone using Google Meet.
5. Wait for Google data and worker checks. Reopen the existing card: actual start,
   end, distinct participants and durations should appear. If identity/access is
   unavailable, expect a specific review/reconnection state, not an incentive.
6. When VERIFIED, confirm exactly one linked entry at the database-configured
   rate; repeat Check Meeting Status and restart the backend to confirm no replay.
7. Download the PDF as its owner and Admin; another Faculty/Staff/Student must be
   rejected. Compare the report with Google evidence and IST times.
8. Reuse the Meet link for a different scheduled window: the earlier conference
   must not match. Two overlapping classes or multiple matching conferences must
   require review. Cancel an uncredited class during a check: no credit may result.
9. Disconnect/revoke Google access and check again: show Reconnect without ending
   the Flowlytiks session. Reconnect and confirm retry/restart recovery.

Automated provider responses are mocks, not proof of live Google permissions,
identity metadata availability, data latency or actual API quota behavior.
