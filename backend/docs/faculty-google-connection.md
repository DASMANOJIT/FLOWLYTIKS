# Faculty Google connection

This connection is separate from Flowlytiks authentication. It requests only
`openid` and `https://www.googleapis.com/auth/meetings.space.readonly`, with offline access.
Connection setup itself does not credit incentives. The separate verified Meet
worker is documented in [online-class-meet-verification.md](online-class-meet-verification.md).

## Backend configuration

Use the existing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
`GOOGLE_REDIRECT_URI`. The callback path must be `/api/faculty/google/callback`.
Set `FRONTEND_URL` to the existing frontend origin; otherwise the first
`CORS_ORIGIN` is used. Production callback and frontend URLs must use HTTPS.
Do not add these credentials to frontend environment variables.

Generate a dedicated 32-byte encryption key into a private file outside Git,
without printing it:

```sh
node -e "require('fs').writeFileSync(require('path').join(require('os').homedir(), '.flowlytiks-google-token-key'), require('crypto').randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' })"
```

Set `GOOGLE_TOKEN_ENCRYPTION_KEY` in the backend secret environment to that
file's contents using a secure editor/secret manager. Never reuse JWT_SECRET,
commit the key, or print it in logs. Keep the same key across backend restarts
and instances. Losing/changing it requires Google reconnection. Access tokens,
refresh tokens and temporary PKCE verifiers use AES-256-GCM with faculty-bound
authenticated context. The running OAuth service never rewrites `.env`.

The dashboard connection setup stores a generated key in the ignored local
`backend/.env` only when it is missing. Never regenerate it on startup or replace
an existing key. Restart the backend after configuring it. The dashboard and
Online Doubt Class card share the same faculty connection; scheduling does not
start OAuth again. A class still requires its existing HTTPS Google Meet link.

## Additive migration

Review `20261011100000_faculty_google_connection/migration.sql`: it creates only
the connection and OAuth-state tables, indexes and faculty foreign keys. Review
all pending migrations and confirm the target database before applying:

```sh
cd backend
npx prisma migrate status
npx prisma migrate deploy
npx prisma generate
npm run dev
```

Never reset or use destructive schema synchronization. Do not apply to production
as part of local testing.

## Manual connection test

1. In Google Cloud, enable Google Meet API, configure the OAuth consent screen
   and a Web application OAuth client. Add the faculty's Google account as a test
   user if the app is in Testing. Register the exact backend callback URL already
   configured in the backend (local: `http://localhost:5000/api/faculty/google/callback`).
2. Configure the backend encryption key and frontend origin, apply the reviewed
   additive migration to development, and restart the backend.
3. Log into Flowlytiks as faculty at `http://localhost:3001`. Click Connect Google
   Account beside the Faculty Dashboard heading. The same control remains in
   Extra Incentives, Edit for ONLINE DOUBT CLASS.
4. Approve basic OpenID identity and the Meet read-only permission in Google's consent screen. The
   same browser tab returns to `/faculty/dashboard`. Open the same card again:
   it should show Connected. Flowlytiks should still be logged in.
5. Check Connection explicitly refreshes authorization. Test
   revocation in Google account settings and Check Connection: it must show
   Reconnect required, without logging out of Flowlytiks.
6. Reconnect and approve consent. Disconnect must remove locally stored
   credentials and invalidate pending connection attempts, even if provider
   revocation is unavailable. No class/incentive records change.
7. Test denying consent, waiting beyond the ten-minute state expiry, replaying
   a callback and attempting it without its backend cookie. No connection may be
   created and no code exchange should occur for an invalid/replayed state.

The authenticated POST returns only a short-lived backend launch URL (not an
application auth token or Google secret). A second authenticated POST goes directly
to that backend origin to prepare the browser binding. It sets an HttpOnly cookie
before redirecting to Google (SameSite=Lax on localhost; SameSite=None + Secure on
HTTPS to support cross-site backends). A forwarded ticket alone cannot launch OAuth.
The existing backend CORS allowlist and frontend CSP must allow the configured backend
origin. If the browser blocks third-party cookies, use a same-site backend custom
domain or explicitly allow that connection cookie; the flow fails safely rather than
skipping browser binding. State and launch tickets are hashed, scoped
to faculty, expire after ten minutes and are single-use. PKCE binds the code
exchange. Disconnect/reconnect cancels in-flight attempts under faculty row locks.
Callback redirects contain only an enumerated result fragment, never OAuth codes
or tokens. Provider failures return connection-specific errors, not application 401s.
No email/profile scope is requested. Google identity is used only for Meet verification,
never to sign in to Flowlytiks or replace its session.

## Verified teacher identity upgrade

In Google Cloud / Google Auth Platform / Data access, add `openid` to the
existing Meet read-only scope (if already listed, no additional change is needed).
Do not add email, profile, Drive, recording, or Events scopes. Existing Meet-only
connections must use Reconnect once, selecting the Google account used to join
their class. The UI reports Reconnect required until a verified identity exists.

Review/apply the additive `20261012020000_faculty_google_verified_identity`
migration before regenerating Prisma Client and restarting the backend. It adds
nullable `googleSubject`, `identityVerifiedAt`, and `oidcNonceHash`; it does not
rewrite existing connections or attendance. OAuth attempts started before this
upgrade must be restarted, as they lack the identity nonce.

The supported `google-auth-library` verifies Google's signing certificate,
issuer, audience and expiry. The callback additionally validates expiry,
authorized presenter and its dedicated, hashed, single-use OpenID nonce before
storing the subject. The browser-binding nonce and PKCE remain separate.
Refresh credentials are preserved only for the same verified subject, never
across an account switch.

Google documents `sub` as the stable Google account ID; Meet documents
`SignedinUser.user` as `users/{user}`. Comparison uses `users/` + the verified
bare subject, not a participant resource name, email or display name. A mismatch
remains under review and cannot credit an incentive.

Sources: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
and [Meet SignedinUser](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.participants#SignedinUser).

After reconnection, use Check Meeting Status on the existing completed class.
The normal verification path retains evidence and checks teacher attendance,
non-teacher attendance, cancellation, duplicate conference linkage and the
configured incentive rate. Reconnection alone never credits an incentive.

## Database transient failures

Authentication reads and idempotent heartbeat touches retry a recognized
connection closure/unavailable pool once after 150 ms. Persistent failure is
503 `AUTH_SERVICE_UNAVAILABLE`, not an invalid-login 401; the frontend retains
the current session. No payment transaction is retried by this helper.
No connection limits, credentials or DATABASE_URL are changed. The shared client,
single sequential Meet worker, lease ownership and graceful shutdown remain in use.
For Prisma Postgres, use provider-issued pooled runtime/direct migration URLs
as appropriate; do not construct replacement credentials or assume a closure
proves pool exhaustion. Provider/network diagnostics are needed for repeated
closures that cannot be reproduced locally.
