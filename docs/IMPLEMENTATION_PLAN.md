# Implementation Status

**Status:** competition-ready demonstration build, verified on 2026-10-25.

This document replaces the original from-scratch phase plan. It records what is implemented, how it was verified, and what remains before a production deployment.

## Delivered scope

### Foundation

- [x] React 19 + TypeScript + Vite + Tailwind frontend
- [x] Express 5 + TypeScript + Prisma backend
- [x] SQLite demonstration database with portable Prisma schema
- [x] Environment template without secrets
- [x] Zod request validation and consistent API error format
- [x] JWT HTTP-only cookie authentication and bcrypt password hashing
- [x] Role and scope model: Administrator, Bureau Officer, Regional Officer, Senior Management, Read-Only Viewer
- [x] Idempotent seed with a reproducible demonstration scenario

### Institution identity

- [x] Institution registry keyed by the stable AICTE Permanent ID
- [x] Explainable candidate scoring with evidence and reasoning
- [x] Exact-ID auto-link only; names and aliases never auto-link
- [x] Pending identity request created for unverified intake names
- [x] Identity queue with explicit resolve/dismiss decisions and notes
- [x] Alias storage with cross-institution conflict rejection
- [x] Administrator-only institution merge that preserves cases, alerts and history
- [x] Institution detail with scoped metrics and case history

### Complaint lifecycle

- [x] Case intake with verified institution, exact ID or unverified name
- [x] Server-generated case number, SLA deadline and next-action fields
- [x] Central lifecycle policy in `domain/casePolicy.ts`
- [x] Manual status progression separated from special operations
- [x] Transfer with destination and reason
- [x] Escalation with reason and priority bump
- [x] Disposal with mandatory resolution remarks
- [x] Reopen with mandatory reason and renewed deadline
- [x] Assignment validation against Bureau and role
- [x] Immutable case action history
- [x] Server-computed permission flags returned to the client

### Coordination and alerts

- [x] Cross-Bureau overlap detection per verified institution
- [x] Duplicate-complaint suggestion with local rule-based similarity
- [x] Stable alert keys and idempotent re-evaluation
- [x] Reconciliation that merges duplicate active alerts without deleting history
- [x] Orphan alert dismissal
- [x] Alert review workflow with required outcome/dismissal reason
- [x] Review decisions propagated to linked case histories
- [x] Administrator-only evaluation endpoints
- [x] Alert access scoped by Bureau, Region and linked-case coordination

### SLA

- [x] Single SLA policy module
- [x] Most-specific active rule selection with documented tie-break
- [x] Deadline fallback to `nextActionDueDate` only when `slaDueDate` is null
- [x] Disposed cases never overdue
- [x] Shared snapshot used by list, detail, dashboard, reports and scheduler
- [x] Scheduled evaluation every 15 minutes
- [x] Per-recipient deduplicated reminders and management escalation warnings
- [x] Admin SLA rule management UI and API

### Notifications

- [x] Server-backed notification centre with pagination and unread filter
- [x] Mark one/all read
- [x] Composite unique key for recipient-level deduplication
- [x] Pre-check plus `P2002` race handling
- [x] Assignment, status, transfer, escalation, disposal, reopen, alert and identity notifications
- [x] Authenticated badge polling; no privileged real-time socket

### Dashboard, reports and exports

- [x] All metrics computed from the database with caller scope
- [x] Status, category, Bureau, region, institution and ageing breakdowns
- [x] Six-month received/disposed trend and average disposal time
- [x] Urgent cases and recent alerts
- [x] Shared SLA compliance metrics
- [x] Scope-filtered CSV exports for cases, alerts and institutions
- [x] Formula-injection protection and `nosniff` on exports

### Security and administration

- [x] Server-side authorization on every route and workflow
- [x] Fail-closed Bureau/Region scope
- [x] Inactive-account rejection and per-request user re-load
- [x] Origin guard, CORS allowlist and SameSite cookies
- [x] API security headers
- [x] General and login rate limits
- [x] Admin user management with role/scope consistency and self-protection
- [x] Append-only audit trail without credentials
- [x] Admin audit UI with filters and detail view
- [x] Client admin route guard in addition to server enforcement

### Frontend

- [x] Professional navy/slate/teal design system
- [x] Reusable UI primitives, modal, toast, loading/error/empty states
- [x] Login, dashboard, case register, intake, case detail
- [x] Institution directory and detail
- [x] Identity queue with candidate review
- [x] Overlap register and review detail
- [x] Reports and exports
- [x] Notifications centre
- [x] Users, SLA policy and audit administration
- [x] Responsive navigation with scoped role links and badges
- [x] No `alert()`/`prompt()` in application flows

## Architecture decisions

| Decision | Rationale |
| --- | --- |
| SQLite for the demo | Self-contained; no external database dependency for judges |
| One lifecycle policy module | Prevents endpoint-specific status rules |
| One SLA policy module | Prevents dashboard/report/case mismatches |
| Human review for name matches | Names and aliases are not stable identity |
| Exact AICTE ID auto-link | The official permanent ID is authoritative |
| Stable alert keys | Re-evaluation must update, not duplicate |
| Reconciliation over deletion | Audit and review history must survive consolidation |
| Composite notification dedupe | One event per recipient, safe re-runs |
| HTTP refresh instead of Socket.IO | No privileged room or unauthenticated event payload |
| Fail-closed scope | Missing Bureau/Region is never treated as global |
| Server-computed permissions | UI does not guess what is allowed |

## Verification results

All commands below were run on 2026-10-25 after the final changes.

### Backend

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | Passed, no output |
| Tests | `npm run test:run` | 6 files, 72 tests passed |
| Prisma schema | `npx prisma validate` | Valid |
| Migrations | `npx prisma migrate status` | 2 migrations, schema up to date |
| Seed idempotency | `npm run prisma:seed` (twice) | Stable counts; no duplicates |

Backend test coverage includes authentication, role/scope authorization, lifecycle transitions, SLA selection and snapshots, identity resolution, alert reconciliation and review, notification deduplication, reports, exports and administration.

### Frontend

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc -b` | Passed, no output |
| Tests | `npm test` | 4 files, 22 tests passed |
| Lint | `npm run lint` | Passed with warnings only |
| Production build | `npm run build` | Passed; main JS bundle 960.87 kB (273.61 kB gzip) |

Lint warnings are pre-existing React fast-refresh export warnings plus `set-state-in-effect` warnings in `AuthContext` and `Layout`. They do not fail the lint command.

The build emits a chunk-size warning for the single JS bundle. This is a performance concern, not a correctness failure.

### API workflow verification

A separate end-to-end smoke run against an isolated copy of the demo database exercised 37 checks, including:

- health, admin login and Bureau officer login
- case intake with a pending identity request
- identity queue listing and resolution
- transfer, escalation, disposal and reopening
- SLA state before/after disposal and reopen
- overlap evaluation and canonical alert reconciliation
- alert review and retained review history
- SLA evaluation
- scoped CSV exports
- audit readability with no password hashes
- scoped officer visibility
- `403` for non-admin evaluation endpoints
- notification pagination, privacy and dedupe

The temporary smoke database and script were removed after the run; they are not part of the repository.

## Remaining work (not required for the demo)

### Before a production pilot

1. Move from SQLite to PostgreSQL and rewrite/replace the SQLite migrations for the target provider.
2. Add HTTPS termination, secure cookies, HSTS and a production frontend CSP.
3. Replace the in-memory rate limiter with a shared store; add per-account lockout.
4. Add CSRF tokens or a required custom header for state-changing requests.
5. Add 2FA for administrators and privileged roles.
6. Add database-level append-only enforcement or an external audit sink.
7. Add encryption at rest and a data-retention/PII policy.
8. Add email/SMS notification delivery if required by the operating model.
9. Add dependency scanning, secret scanning and a CI security gate.
10. Commission an independent security and accessibility review.

### Engineering improvements

1. Split the frontend bundle with route-level `React.lazy` and manual vendor chunks.
2. Resolve the remaining lint warnings by separating non-component exports and deriving effect state.
3. Add frontend tests for the case workflow, identity resolution and admin guard.
4. Add browser-level end-to-end tests (Playwright) for the primary demo path.
5. Add database indexes or query limits if the case volume grows beyond the demo dataset.
6. Scope `GET /api/institutions/match` candidates more tightly if the registry grows and cross-region candidate visibility becomes a concern.

## Out of scope by design

- Real AICTE data or official SLA durations
- External AI/LLM services for matching
- Automatic institution merges or automatic complaint dispositions
- A privileged real-time event channel
- Native mobile applications
- Email/SMS gateways

## Progress log

| Date | Milestone |
| --- | --- |
| 2026-10-24 | Repository assessment and initial scaffolding |
| 2026-10-25 | Lifecycle, SLA, identity, alert, notification and authorization hardening |
| 2026-10-25 | Frontend redesign and complete workflow screens |
| 2026-10-25 | Backend/frontend tests, seed idempotency and API smoke verification |
| 2026-10-25 | Documentation reconciled with the implemented system |
