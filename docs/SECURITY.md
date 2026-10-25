# Security Model

This document describes the security controls that are actually implemented in the demonstration build, plus the controls that are intentionally out of scope. It is written for reviewers and for anyone deploying the project beyond a competition demo.

> This is not a production-certified system. It handles synthetic data only. A real AICTE deployment would require institutional security review, infrastructure hardening, independent testing and formal data-protection compliance.

## Threat model

The application protects a multi-role grievance workflow where the main risks are:

1. An authenticated user reading or changing records outside their Bureau/Region.
2. A read-only or senior-management user performing workflow operations.
3. A user bypassing required lifecycle evidence (transfer destination, disposal outcome, reopen reason).
4. Cross-site request forgery through the session cookie.
5. Credential or audit-data leakage through API responses or logs.
6. Duplicate or replayed notification/alert processing.
7. Injection through filters, CSV exports or request bodies.

## Authentication

| Control | Implementation |
| --- | --- |
| Credential storage | bcrypt hashing (`bcryptjs`, 12 salt rounds) |
| Session transport | JWT in an HTTP-only cookie named `aicte_session` |
| Token lifetime | `JWT_EXPIRES_IN` (default `7d`); cookie `maxAge` is 7 days |
| Cookie flags | `HttpOnly: true`, `SameSite` from `COOKIE_SAME_SITE` (default `lax`), `Secure` when `COOKIE_SECURE=true` |
| Login throttling | 20 attempts / 15 minutes per IP, separate bucket from the general API limit |
| Session validation | Token signature + expiry; user is re-read from the database on every request |
| Inactive accounts | Rejected immediately, even with an otherwise valid token |
| Logout | Clears the cookie and writes an audit event |
| Password changes | Hashed with bcrypt; password values are excluded from audit details |

The JWT payload carries only `sub`, `role`, `bureauId` and `regionId`. Authorization decisions re-load the current user row, so role/scope changes and deactivation do not require waiting for token expiry.

`JWT_SECRET` is required. The API refuses to sign tokens if it is missing. The demo `.env.example` value must be replaced before any shared deployment.

## Authorization

Authorization is enforced on the server, never only by hiding UI controls.

- `authenticate` validates the session and loads the current user with Bureau and Region relations.
- `authorize(...roles)` gates routes that are role-specific (admin, institution management, identity resolution).
- Service-layer predicates decide record access:
  - `caseScopeWhere` / `canAccessCase` / `canModifyCase`
  - `institutionScopeWhere` / `canAccessInstitution`
  - `alertScopeWhere` / `canReviewAlerts`
- Workflow services re-check `canModifyCase` before changing a case.
- Read-only roles (`READ_ONLY`, `SENIOR_MANAGEMENT`) cannot create complaints, modify cases, review alerts or manage institutions.
- Missing Bureau/Region scope fails closed (`__no_access__` or an explicit `403`). It never degrades into global access.
- A Bureau officer can read a case outside their Bureau only through a coordination alert that links it to a case in their Bureau.
- Administrative endpoints require `ADMIN`; the institution merge and both evaluation endpoints are administrator-only.
- Admin user creation/update validates that role and scope agree: Bureau officers need an active Bureau, Regional officers need an active Region, and other roles cannot carry either assignment.
- Administrators cannot change their own role or deactivate their own account.

The frontend has matching route/navigation guards for convenience, but those guards are not a security boundary. Every corresponding API call is independently authorized.

## CSRF and cross-origin protection

Because the session is a cookie, state-changing requests use three layers:

1. `SameSite=lax` (or stricter) on the session cookie.
2. A CORS allowlist driven by `FRONTEND_URL` (comma-separated origins are supported). Disallowed origins receive no CORS headers.
3. `originGuard` on every state-changing route: when an `Origin` header is present and not in the allowlist, the request is rejected with `403`. Safe methods (`GET`, `HEAD`, `OPTIONS`) and non-browser clients without an `Origin` header are allowed.

The frontend defaults to same-origin `/api` through the Vite proxy, so the browser sends first-party cookies.

This is not a token-based CSRF scheme. For a production deployment, add a per-session CSRF token or require a custom header for state-changing requests, and keep the origin allowlist strict.

## Input validation and injection

- All request bodies are validated with Zod schemas before reaching services.
- Pagination values are coerced and bounded (`pageSize` ≤ 100).
- Unknown extra fields are ignored by Zod object parsing; they are not passed through to Prisma.
- Prisma uses parameterized queries, preventing SQL injection through filters and IDs.
- JSON request bodies are limited to 1 MB.
- CSV exports quoting-escape every cell and prefix formula starters (`=`, `+`, `-`, `@`, tab, carriage return) to prevent spreadsheet formula injection.
- The application does not accept file uploads, so there is no upload path to harden in this build.
- React escapes rendered values by default; the app does not use `dangerouslySetInnerHTML`.

## Security headers

The API sets the following headers on every response:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `X-Permitted-Cross-Domain-Policies: none`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-site`
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
- `Strict-Transport-Security` only when `COOKIE_SECURE=true`

The CSP is deliberately strict because the API only returns JSON/CSV. The Vite dev server does not apply these headers to the SPA itself; a production deployment should serve the built frontend over HTTPS with its own CSP and HSTS configuration.

## Rate limiting

- General API: 600 requests per minute per IP.
- Login: 20 requests per 15 minutes per IP.
- Responses expose `X-RateLimit-Limit`, `X-RateLimit-Remaining` and, where relevant, `X-RateLimit-Reset` / `Retry-After`.

The limiter is an in-memory fixed window. It is suitable for a single-process demo but not for a multi-instance deployment; use a shared store such as Redis in production.

## Audit trail and data minimisation

- Mutations write an `AuditEvent` with action, entity type/ID, acting user, timestamp, IP, user agent (truncated) and structured details.
- Case workflow actions are stored separately in `CaseActionHistory` and are never edited by the application.
- Admin user updates record which fields changed, plus role/scope/active state — never the password or its hash.
- Login/logout are audited.
- API list/detail responses select public user fields; password hashes are never serialized.
- Notification payloads are scoped to the owning user.
- Alert and case evidence is stored as JSON strings and parsed defensively before display.

The audit trail is append-only in application behaviour. The database does not enforce immutability: an administrator with direct database access could alter rows. Production deployments should add database-level permissions, write-once storage or an external log sink.

## Notification and alert idempotency

- `@@unique([userId, dedupeKey])` makes each notification event at most once per recipient.
- `createNotification` pre-checks the key and also tolerates a `P2002` race.
- SLA reminders use `sla:<caseId>:<state>:<deadline date>`; a new deadline produces a new reminder.
- Alert identities are stable (`cross-bureau:<institutionId>`, sorted duplicate case pair), so re-evaluation updates rather than duplicates.
- Re-evaluation consolidates duplicate active alerts without deleting history.

## Secrets and configuration

| Variable | Security relevance |
| --- | --- |
| `JWT_SECRET` | Token signing secret; required and must be long/random |
| `JWT_EXPIRES_IN` | Session lifetime |
| `COOKIE_SECURE` | Enables `Secure` cookies and HSTS |
| `COOKIE_SAME_SITE` | Cookie SameSite policy |
| `FRONTEND_URL` | CORS and origin-guard allowlist (comma-separated) |
| `DATABASE_URL` | SQLite file location |
| `PORT` | API port |
| `NODE_ENV` | Suppresses unhandled-error logging in tests |

`.env` is excluded from version control; `.env.example` contains placeholders only. The code never logs request bodies, cookies or secrets. Never commit the real `.env` or a populated SQLite database.

The demo SQLite file (`backend/prisma/dev.db`) contains synthetic accounts with the shared password `Demo@123`. Treat it as public demo data, not as a secure credential store.

## Known limitations

- No 2FA or step-up authentication for administrators.
- No server-side session revocation list. Deactivation and role changes take effect on the next request because the user row is re-read, but a stolen token remains usable until expiry unless the account is deactivated.
- No encryption at rest for the SQLite file or individual fields.
- No email/SMS delivery; notifications are in-app only.
- Rate limiting is per process and in-memory.
- The origin guard relies on browser-supplied `Origin`; non-browser clients can omit it. SameSite cookies remain the primary CSRF control.
- No formal penetration test, dependency-audit gate or load test has been performed.
- The audit trail is append-only by application convention, not database enforcement.
- The frontend development server does not set the API's security headers.
- Institution matching accepts names from authenticated users and searches the registry globally. It returns limited identity fields and never links automatically, but a stricter deployment could scope candidates to the caller's region.

## Production checklist

1. Replace `JWT_SECRET`; set `COOKIE_SECURE=true` and `COOKIE_SAME_SITE` appropriate to the deployment.
2. Serve the SPA and API over HTTPS only; add HSTS at the edge.
3. Move to PostgreSQL (or another server database) with encrypted storage and least-privilege credentials.
4. Use a shared rate-limit store and add per-account login lockout/alerting.
5. Add CSRF tokens or a required custom header for state-changing requests.
6. Add 2FA for administrators and privileged roles.
7. Put the audit trail behind append-only permissions and ship it to an external log sink.
8. Add dependency scanning, secret scanning and a CI security gate.
9. Add data-retention and PII handling policies; encrypt sensitive fields at the application level if required.
10. Commission an independent security review before handling real complainant data.
