# Architecture

## System overview

The application is a three-tier web system:

```
React 19 SPA  ──/api (HTTP-only cookie)──►  Express 5 API  ──Prisma──►  SQLite (demo)
```

- **Presentation** — React, React Router, Tailwind, Recharts. No business authority lives in the browser.
- **Application** — Express controllers, domain policy modules, services and Prisma.
- **Data** — SQLite for a self-contained demonstration. The Prisma schema is written so the data model can move to PostgreSQL; the bundled migrations target SQLite.

## Design principles

1. **Institution identity is stable.** Cases link to an institution only through an exact AICTE Permanent ID or an authorised human decision. Names and aliases are evidence, never authority.
2. **One policy per concern.** Lifecycle transitions live in `domain/casePolicy.ts`; SLA calculation lives in `domain/slaPolicy.ts`; alert identities live in `services/matching/overlapKeys.ts`; notification recipient selection lives in `services/notificationService.ts`.
3. **Workflow operations carry their evidence.** Transfer, escalation, disposal and reopening cannot be reached through the generic status endpoint, so required reasons and outcomes cannot be bypassed.
4. **Fail-closed authorization.** Every scope predicate is evaluated on the server. Missing Bureau/Region scope denies access rather than silently becoming global.
5. **History over replacement.** Alert reconciliation merges linked cases, reviews, notifications and action references into a canonical alert. Audit and action history are append-only.
6. **Explainable matching.** Candidates expose score, confidence and reasoning. Uncertain matches require review; nothing is auto-merged.
7. **No privileged real-time channel.** The client refreshes authorised API data. `realtime.ts` is an in-process signal only.

## Backend structure

```
backend/src/
├── config/               # Prisma client
├── controllers/          # HTTP request/response mapping
├── domain/
│   ├── casePolicy.ts     # lifecycle states, manual vs workflow transitions
│   └── slaPolicy.ts      # rule selection, deadline, SLA snapshot
├── middleware/           # auth, origin guard, security headers/rate limit, errors
├── routes/               # route tables and role gates
├── services/
│   ├── authorization.ts  # case/institution/alert scope predicates
│   ├── caseService.ts    # intake, lifecycle, assignment, decorated cases
│   ├── institutionService.ts  # registry, identity queue, aliases, merge
│   ├── alertService.ts   # alert listing, scope, review workflow
│   ├── dashboardService.ts
│   ├── reportService.ts
│   ├── slaService.ts     # scheduled evaluation and notifications
│   ├── notificationService.ts
│   ├── auditService.ts
│   └── matching/
│       ├── overlapKeys.ts       # stable alert identities
│       ├── overlapDetection.ts  # evaluation and reconciliation
│       └── institutionMatcher.ts
├── validators/           # Zod request schemas
├── utils/
├── realtime.ts           # in-process, non-privileged change signals
└── index.ts              # app assembly, CORS, security, routes
```

## Complaint lifecycle

A case has one status, but not every status is a generic transition.

**Ordinary review progression** (`POST /api/cases/:id/status`):

- `RECEIVED → UNDER_REVIEW`
- `UNDER_REVIEW → UNDER_PROCESS`
- `UNDER_PROCESS → UNDER_REVIEW`
- Transferred, escalated and reopened cases may return to `UNDER_REVIEW` or `UNDER_PROCESS`.

**Dedicated workflows:**

| Operation | Endpoint | Required evidence | Result |
| --- | --- | --- | --- |
| Transfer | `POST /cases/:id/transfer` | destination Bureau, reason | `TRANSFERRED`, Bureau changed, history recorded |
| Escalate | `POST /cases/:id/escalate` | reason | `ESCALATED`, low/medium priority raised |
| Dispose | `POST /cases/:id/dispose` | meaningful resolution remarks | `DISPOSED`, closed timestamp |
| Reopen | `POST /cases/:id/reopen` | meaningful reason | `REOPENED`, active deadline restored |

`DISPOSED` is the only closed status. `TRANSFERRED` remains open for SLA purposes. The full policy table is exported from `casePolicy.ts` and tested directly.

Every mutation writes case action history and an audit event. The case detail response exposes the history, available workflow actions and the server-computed permission flags, so the UI does not guess what is allowed.

## Institution identity resolution

Intake supports three paths:

1. **Verified institution** — the client selected an institution from the registry.
2. **Exact AICTE Permanent ID** — the server may link automatically because the ID is the stable identifier.
3. **Unverified name** — the case keeps `institutionId = null`, preserves `originalInstitutionName`, and creates an `InstitutionResolution` row in `PENDING`.

`GET /api/institutions/match` returns candidates with score, `requiresReview`, `autoLink` and reasoning. A name or alias match never links a case on its own.

An authorised officer (`ADMIN` or `REGIONAL_OFFICER`) resolves the queue entry by selecting an institution or dismissing it with a note. Resolution links the case, records the reviewer and timestamp, and writes an audit event. Alias conflicts across institutions are rejected rather than silently reassigned.

Merging institutions is administrator-only. It moves cases and alerts to the target, migrates compatible aliases, records what was merged, and audits the operation.

## Cross-Bureau and duplicate alerts

Two alert families use deterministic identities:

- **Cross-Bureau overlap:** `cross-bureau:${institutionId}` — one alert per institution.
- **Potential duplicate:** `duplicate:${sortedCaseIdA}:${sortedCaseIdB}` — one alert per unordered case pair.

`evaluateAllOverlaps` computes current signals and reconciles them with persisted alerts:

- New signals create alerts.
- Existing active alerts update evidence and linked cases.
- Duplicate active alerts are merged into a canonical alert; reviews, notifications and case/action references are re-pointed, and the duplicate is dismissed with a reason.
- Active alerts with no supporting cases are dismissed as orphans.
- Terminal alerts are preserved and reopened only if the signal recurs.

The alert review workflow is explicit:

```
NEW ──► UNDER_REVIEW ──► COORDINATION_REQUIRED ──► RESOLVED
  └──────────┴──────────────┴──────────────────────► DISMISSED
```

`RESOLVED` requires an outcome; `DISMISSED` requires a dismissal reason. Terminal alerts cannot transition again. Each review creates an `AlertReview`, case action entries and notifications.

## SLA policy

SLA authority is `domain/slaPolicy.ts`.

1. Active rules are filtered by any configured category, Bureau and priority.
2. The most specific rule wins: category (4) + Bureau (2) + priority (1); ties break on newest rule.
3. The deadline is `dateReceived + slaDurationHours`.
4. The snapshot uses `slaDueDate` first, falling back to the operational `nextActionDueDate` when the former is null.
5. A case is **overdue** when the deadline is in the past and the case is not `DISPOSED`.
6. A case is **approaching** inside the warning window.
7. A disposed case always reports `state = NONE` and is never counted as overdue.

The same helper feeds case lists, case detail, dashboard metrics, reports, the scheduled evaluator and seed data. `slaService` records overdue/approaching reminders with recipient-level dedupe keys.

## Notifications

- A notification belongs to one user.
- `@@unique([userId, dedupeKey])` makes each event idempotent per recipient.
- `createNotification` checks for an existing key before insert and tolerates a `P2002` race.
- `caseRecipientIds` includes the assignee, creator and active officers in the current Bureau, deduplicated.
- Post-commit delivery (`notifyUsersSafe`) never rolls back a completed business transaction if a notification write fails.

The client reads `/api/notifications`, `/unread-count`, marks one or all as read, and polls the badge through its normal authenticated session. There are no socket rooms or privileged event payloads.

## Dashboard and reports

All aggregates are computed from the database with the caller's scope:

- case totals by status, pending/active/disposed counts
- overdue and approaching counts from the shared SLA snapshot
- active, duplicate and review-required alerts
- pending identity resolutions
- Bureau and region workload, category distribution, ageing buckets, monthly trend
- urgent cases and recent alerts
- SLA compliance and disposal metrics

`GET /api/reports/export/*` produces scoped CSV with formula-injection protection. Evaluations (`/alerts/evaluate/run`, `/reports/sla/evaluate`) are administrator-only.

## Frontend architecture

- `services/api.ts` — Axios client; defaults to same-origin `/api`, supports `VITE_API_URL`, dispatches `aicte:unauthorized` on a 401.
- `contexts/AuthContext.tsx` — session restore, login/logout, role helpers; clears state on unauthorized.
- `components/ProtectedRoute.tsx` — redirects unauthenticated users to `/login` and keeps non-admin roles out of `/admin/*` routes; the API independently enforces the same rule.
- `layouts/Layout.tsx` — responsive navigation, role-gated administration links, 30-second badge polling and refresh on `aicte:refresh`.
- `components/ui.tsx` — buttons, inputs, cards, badges, modal, pagination, description lists, loading/error/empty states.
- `components/Toast.tsx` — accessible success/error/info notifications; pages do not use `alert()` or `prompt()`.
- `hooks/useAsyncData.ts` — guarded async loading with explicit dependencies and reload.
- `services/types.ts` — response contracts shared by pages.

Screens: login, dashboard, case list, case detail with workflow modals, complaint intake with identity guidance, institution registry/detail, identity queue, overlap list/detail, reports, notifications, users, SLA policy and audit trail.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite file URL, e.g. `file:./dev.db` |
| `JWT_SECRET` | Token signing secret; must be replaced outside the demo |
| `JWT_EXPIRES_IN` | Session lifetime |
| `PORT` | API port (default 5000) |
| `FRONTEND_URL` | Allowed browser origin(s), comma-separated |
| `COOKIE_SECURE` | Require HTTPS cookies |
| `COOKIE_SAME_SITE` | Cookie SameSite policy |
| `VITE_API_URL` | Optional frontend API base override |

## Testing architecture

- **Backend** — Vitest + Supertest. Global setup force-resets an isolated `prisma/test.db`; tests never touch `dev.db`. Policy, authorization, identity, lifecycle, alerts, notifications and API contracts are covered.
- **Frontend** — Vitest + jsdom + Testing Library. Helpers, UI primitives, auth state and notification workflow are covered.
- **Smoke verification** — an external script can be run against a copy of the demo database to exercise login, intake, identity resolution, transfer/escalate/dispose/reopen, alert review, SLA/overlap evaluation, exports, audit and negative authorization checks.
