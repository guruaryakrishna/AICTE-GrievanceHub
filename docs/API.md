# API Reference

Base URL: `http://localhost:5000/api` (the frontend Vite dev server proxies `/api` to this address).

All request and response bodies are JSON unless noted. CSV endpoints return `text/csv`.

## Conventions

### Authentication

Login sets an HTTP-only cookie named `aicte_session`. The cookie is sent automatically by the browser; there is no bearer-token header. All endpoints except `GET /health` and `POST /api/auth/login` require a valid session.

### Pagination

List endpoints that support pagination accept:

| Parameter | Default | Rules |
| --- | --- | --- |
| `page` | `1` | Integer ≥ 1 |
| `pageSize` | `20` | Integer 1–100 |

Paginated responses use `{ "items": [...], "total": 123 }`. The client computes page counts from `total`; there is no separate metadata object.

### Error format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [{ "path": "title", "message": "Title must be at least 5 characters" }]
  }
}
```

| Status | Meaning |
| --- | --- |
| `400` | Validation or business-rule failure (`VALIDATION_ERROR`, `BAD_REQUEST`, `WORKFLOW_POLICY`) |
| `401` | Missing, expired or inactive session (`UNAUTHORIZED`) |
| `403` | Authenticated but not permitted, or missing Bureau/Region scope (`FORBIDDEN`) |
| `404` | Record not found or not visible (`NOT_FOUND`) |
| `409` | Duplicate/identity conflict (`CONFLICT`) |
| `429` | Rate limited (`RATE_LIMITED`) |
| `500` | Unexpected server error (`INTERNAL_ERROR`); no stack trace is returned |

### Roles

| Role | Read scope | Write scope |
| --- | --- | --- |
| `ADMIN` | All AICTE | All workflows, administration, merge, evaluation |
| `BUREAU_OFFICER` | Cases in the assigned Bureau/Cell, plus cases linked to those cases through a coordination alert | Cases currently in the assigned Bureau |
| `REGIONAL_OFFICER` | Cases for institutions in the assigned Region | Cases for institutions in the assigned Region; institution and identity administration inside the Region |
| `SENIOR_MANAGEMENT` | All AICTE | Read-only workflow (cannot mutate cases, alerts or institutions) |
| `READ_ONLY` | All AICTE | Read-only |

Missing/mismatched Bureau or Region assignment denies access rather than widening it.

### Scope notes

- A case is visible to a Bureau officer when the case is currently in their Bureau, they created it, or it is linked through an alert to a case in their Bureau.
- Institution-level metrics only include cases with a verified `institutionId`. Unverified intake is tracked in the identity queue.
- All computed SLA fields come from one policy. See [Architecture](ARCHITECTURE.md#sla-policy).

## Health

### `GET /health`

No authentication. Returns service status, timestamp, database mode and the real-time transport description.

```json
{
  "status": "ok",
  "timestamp": "2026-10-25T12:00:00.000Z",
  "service": "aicte-complaint-backend",
  "database": "sqlite (demonstration)",
  "realtime": "authenticated http refresh"
}
```

## Authentication

### `POST /api/auth/login`

Rate limited to 20 attempts per 15 minutes per IP.

```json
{ "email": "admin@aicte-demo.gov.in", "password": "Demo@123" }
```

Response `200`:

```json
{
  "user": {
    "id": "…",
    "email": "admin@aicte-demo.gov.in",
    "firstName": "Demo",
    "lastName": "Admin",
    "role": "ADMIN",
    "bureauId": null,
    "regionId": null,
    "bureau": null,
    "region": null
  }
}
```

### `GET /api/auth/me`

Returns `{ "user": { … } }` for the current session. The user record is re-read from the database on every request, so deactivation and role changes take effect without waiting for token expiry.

### `POST /api/auth/logout`

Clears the cookie, writes a `LOGOUT` audit event and returns `{ "message": "Logged out successfully" }`.

## Institutions

Institution records use the AICTE Permanent ID as the stable business identity. Names and aliases are evidence only.

### `GET /api/institutions`

Filters: `q`, `regionId`, `state`, `isActive` (`true`/`false`), `page`, `pageSize`, `sortBy` (`name`, `aictePermanentId`, `createdAt`), `sortOrder` (`asc`/`desc`).

Response: `{ "items": [...], "total": 123 }`. Each item includes `region`, `aliases`, `_count.cases`, `_count.alerts` and a parsed `alternateNamesList`.

### `GET /api/institutions/match`

Explainable identity matching. At least one of `name` or `aictePermanentId` is required. Optional corroboration: `pinCode`, `district`, `state`, `city`.

```json
{
  "candidates": [
    {
      "institution": {
        "id": "…",
        "aictePermanentId": "DEMO-123456",
        "name": "ABC Engineering College",
        "city": "Gurgaon",
        "district": "Gurgaon",
        "state": "Haryana",
        "pinCode": "122001",
        "regionId": "…"
      },
      "score": 0.92,
      "requiresReview": true,
      "autoLink": false,
      "evidence": [{ "type": "ALIAS_EXACT", "detail": "Matches known alias …", "weight": 0.58 }],
      "reasoning": "Similar identity evidence found; authorized review required before linking."
    }
  ]
}
```

Only an exact AICTE Permanent ID produces `autoLink: true`. A name or alias match never auto-links.

### `GET /api/institutions/meta/regions`

Active regions: `{ "regions": [...] }`.

### `GET /api/institutions/meta/bureaus`

Active Bureaus/Cells: `{ "bureaus": [...] }`.

### `GET /api/institutions/meta/categories`

Active complaint categories: `{ "categories": [...] }`.

### `GET /api/institutions/identity/queue`

Unresolved intake identity requests, scoped to the caller. Filters: `status` (comma-separated `PENDING`, `RESOLVED`, `DISMISSED`; defaults to `PENDING`), `q`, `page`, `pageSize`.

Response: `{ "items": [...], "total": 1 }`. Each item includes the linked `case`, `resolvedInstitution`, `resolvedBy` and parsed `candidateEvidence`.

### `GET /api/institutions/identity/stats`

`{ "stats": { "pending": 1, "resolved": 0, "dismissed": 0 } }`.

### `POST /api/institutions/identity/:id/resolve`

`ADMIN` or `REGIONAL_OFFICER` only. Exactly one of the two modes:

```json
{ "institutionId": "…", "note": "Confirmed against the admission letter." }
```

```json
{ "dismiss": true, "note": "No document confirmed the institution name." }
```

Linking updates the case's `institutionId`, preserves the submitted name as `originalInstitutionName`, adds the submitted name as an alias when free, writes a case action and audit event, and re-evaluates overlaps. A dismissal keeps the case unverified and requires a note.

Response: `{ "resolution": { … } }`. Re-resolving a non-pending request returns `409`.

### `GET /api/institutions/:id`

Returns `{ "institution": { …, "cases": [...], "alerts": [...], "metrics": {...} } }`. Cases are SLA-decorated and restricted to the caller's case scope. Metrics include total, pending, active, disposed, overdue and approaching counts plus `casesByBureau`.

### `POST /api/institutions`

`ADMIN` or `REGIONAL_OFFICER` only. Regional officers are forced into their own region.

```json
{
  "aictePermanentId": "DEMO-999999",
  "name": "Example Institute",
  "alternateNames": ["Example Tech"],
  "institutionType": "Engineering",
  "city": "Pune",
  "district": "Pune",
  "state": "Maharashtra",
  "regionId": "…",
  "pinCode": "411001",
  "contactDetails": { "email": "office@example.edu" },
  "isActive": true
}
```

If candidate duplicates exist, the request fails with `409` and `error.details.candidates`. To proceed, resend with `confirmPotentialDuplicate: true` and a non-empty `duplicateJustification`. An existing exact AICTE Permanent ID also returns `409`.

### `PATCH /api/institutions/:id`

`ADMIN` or `REGIONAL_OFFICER` only. Accepts a partial institution body. Regional officers cannot move a record outside their region. Changing to an AICTE Permanent ID already in use returns `409`.

### `POST /api/institutions/:id/aliases`

`ADMIN` or `REGIONAL_OFFICER` only.

```json
{ "alias": "Example Institute of Technology" }
```

Aliases are normalized. An alias that already identifies another institution, or equals another institution's name, returns `409`. Response `201`: `{ "alias": { … } }`.

### `POST /api/institutions/:id/merge`

`ADMIN` only. Merges the source institution into a target.

```json
{ "targetInstitutionId": "…", "reason": "Confirmed duplicate records for the same permanent ID." }
```

Cases, alerts and identity resolutions move to the target. Compatible aliases are migrated. The source is deactivated rather than deleted. Response: `{ "mergedInto": "<target id>" }`.

## Cases

### `GET /api/cases`

Filters:

| Parameter | Notes |
| --- | --- |
| `q` | Case number, title, description, institution name/ID, original name |
| `status` | Comma-separated statuses |
| `priority` | Comma-separated `LOW`, `MEDIUM`, `HIGH`, `URGENT` |
| `bureauId`, `regionId`, `categoryId`, `assignedOfficerId`, `institutionId` | Exact IDs |
| `dateFrom`, `dateTo` | `dateReceived` range |
| `dueFrom`, `dueTo` | SLA/deadline range |
| `overdue` | `true` to include only overdue open cases |
| `page`, `pageSize`, `sortBy`, `sortOrder` | `sortBy`: `createdAt`, `priority`, `nextActionDueDate`, `slaDueDate`, `dateReceived`, `caseNumber` |

Response: `{ "items": [...], "total": 123 }`. Each case includes:

- `sla`: `{ dueAt, state, isOverdue, isApproaching, hoursRemaining, warningThresholdHours, escalationThresholdHours, ruleId, ruleName }`
- `permissions`: `canModify`, `canAssign`, `canAddAction`, `canTransfer`, `canEscalate`, `canDispose`, `canReopen`
- `allowedStatusTargets` and `availableWorkflowActions`
- `actionHistory`, linked `alerts` and `identityResolution`

### `POST /api/cases`

Any role except `READ_ONLY` and `SENIOR_MANAGEMENT`. A Bureau officer's case is forced into their Bureau. A Regional officer may only use institutions in their Region.

Identity paths:

1. `institutionId` — verified institution selected from the registry.
2. `institutionAictePermanentId` — exact stable ID; the server links automatically.
3. `originalInstitutionName` — unverified name; the case keeps `institutionId = null` and creates a `PENDING` identity request. Candidates are suggestions only.

At least one identity path is required.

```json
{
  "institutionId": "…",
  "title": "Delay in scholarship disbursement",
  "description": "Students report that approved scholarships have not been credited for the current semester.",
  "categoryId": "…",
  "priority": "HIGH",
  "currentBureauId": "…",
  "assignedOfficerId": "…",
  "dateReceived": "2026-10-20T00:00:00.000Z",
  "nextRequiredAction": "Verify disbursement records",
  "nextActionDueDate": "2026-10-30T00:00:00.000Z",
  "expectedDisposalDate": "2026-11-05T00:00:00.000Z",
  "identityReviewNote": "Optional intake context"
}
```

`title` requires 5–240 characters; `description` 20–20,000 characters. `priority` defaults to `MEDIUM`. The server computes `slaDueDate` from the active SLA policy. Response `201`: `{ "case": { … } }`.

### `GET /api/cases/meta/officers`

Assignable active users (`ADMIN`, `BUREAU_OFFICER`). Optional `bureauId`. Bureau officers are restricted to their own Bureau. Response: `{ "officers": [...] }`.

### `GET /api/cases/:id`

Returns `{ "case": { … } }` with history, alert links, identity request, SLA and server-computed permissions. A Bureau or Regional officer may also read a case connected through a coordination alert even when it is not in their own scope.

### `POST /api/cases/:id/status`

Ordinary review progression only:

- `RECEIVED → UNDER_REVIEW`
- `UNDER_REVIEW → UNDER_PROCESS`
- `UNDER_PROCESS → UNDER_REVIEW`
- `TRANSFERRED`, `ESCALATED` and `REOPENED` may move to `UNDER_REVIEW` or `UNDER_PROCESS`

```json
{ "status": "UNDER_REVIEW", "remarks": "Initial review started." }
```

Attempting `TRANSFERRED`, `ESCALATED`, `DISPOSED` or `REOPENED` here returns `400` with a workflow-policy message. Use the dedicated endpoint.

### `POST /api/cases/:id/actions`

```json
{
  "remarks": "Documents received from the institution.",
  "nextRequiredAction": "Inspect records",
  "nextActionDueDate": "2026-11-01T00:00:00.000Z",
  "actionType": "REMARK"
}
```

`remarks` requires at least 2 characters. Updates the case's last action and optional next-action fields.

### `POST /api/cases/:id/assign`

```json
{ "assignedOfficerId": "…", "remarks": "Assigned for inspection." }
```

Send `null` to unassign. The officer must be active and belong to the case's Bureau (unless they are an administrator).

### `POST /api/cases/:id/transfer`

```json
{
  "toBureauId": "…",
  "toOfficerId": "…",
  "reason": "Regulatory review required under the approval norms."
}
```

Destination must differ from the current Bureau and be active. Status becomes `TRANSFERRED`; the case remains open for SLA purposes. `reason` requires at least 5 characters.

### `POST /api/cases/:id/escalate`

```json
{ "reason": "Repeated non-response from the institution.", "escalateTo": "Senior Management" }
```

Status becomes `ESCALATED`; `LOW`/`MEDIUM` priority is raised to `HIGH`. `reason` requires at least 5 characters. Management users are notified.

### `POST /api/cases/:id/dispose`

```json
{ "resolutionRemarks": "Institution submitted corrected records; compliance confirmed and matter closed." }
```

`resolutionRemarks` requires at least 10 characters. Status becomes `DISPOSED`, `disposedAt` is set, next-action fields are cleared, and the case stops counting as overdue.

### `POST /api/cases/:id/reopen`

```json
{ "reason": "New evidence shows the compliance issue was not resolved." }
```

`ADMIN` or an officer with modify access. Only `DISPOSED` cases can be reopened. `reason` requires at least 10 characters. The previous resolution and disposal date are preserved in history; a new SLA deadline is calculated from the reopen time.

## Overlap alerts

Two deterministic alert families:

- `CROSS_BUREAU_OVERLAP` — key `cross-bureau:<institutionId>`
- `POTENTIAL_DUPLICATE` — key `duplicate:<caseIdA>:<caseIdB>` (case IDs sorted)

Re-evaluation updates the existing alert and preserves history. Duplicate active alerts are consolidated into a canonical row and dismissed with a reason; they are never deleted.

### `GET /api/alerts`

Filters: `status` (comma-separated), `alertType`, `institutionId`, `q`, `page`, `pageSize`.

Response: `{ "items": [...], "total": 2 }`. Items include `institution`, linked `cases` and `reviews`.

### `GET /api/alerts/:id`

Returns `{ "alert": { … } }` with institution, linked case details, parsed evidence and the full review history. Access is scoped; a linked-case relationship can grant coordination visibility to a Bureau officer.

### `POST /api/alerts/:id/review`

Any role except `READ_ONLY` and `SENIOR_MANAGEMENT`.

```json
{
  "status": "COORDINATION_REQUIRED",
  "remarks": "Both Bureaus should compare their findings.",
  "outcome": null,
  "dismissalReason": null,
  "assignedCoordinatorId": "…"
}
```

Allowed transitions:

```
NEW ──► UNDER_REVIEW ──► COORDINATION_REQUIRED ──► RESOLVED
  └──────────┴──────────────┴──────────────────────► DISMISSED
```

- `RESOLVED` requires a non-empty `outcome`.
- `DISMISSED` requires a non-empty `dismissalReason`.
- `RESOLVED` and `DISMISSED` are terminal.
- Each review writes an `AlertReview`, a case action on every linked case, an audit event and recipient-deduplicated notifications.
- Response: `{ "alert": { … } }` using the same decorated shape as `GET /api/alerts/:id`.

### `POST /api/alerts/evaluate/run`

`ADMIN` only. Optional `?institutionId=…` to evaluate one institution. Response:

```json
{
  "result": {
    "created": 0,
    "updated": 2,
    "dismissedOrphans": 0,
    "institutions": 2
  }
}
```

When `institutionId` is supplied: `{ "result": { "created": 0, "updated": 1, "alerts": ["…"] } }`.

## Dashboard

### `GET /api/dashboard`

Authenticated and scope-filtered. Filters: `bureauId`, `regionId`, `categoryId`, `dateFrom`, `dateTo`.

Response includes:

- `metrics`: totals, pending, active, status counts, disposed, overdue, approaching, active/duplicate/review alerts, pending identity resolutions, disposal rate, average disposal days
- `quickStats`
- `statusDistribution`, `categoryDistribution`
- `bureauWorkload`, `regionWorkload`, `topInstitutions`
- `ageing`, `trends` (six months), `urgentCases`, `recentAlerts`
- `generatedAt`, `filters`

Every number is computed from the database with the shared SLA policy. There are no client-side or hard-coded statistics.

## Reports

### `GET /api/reports/summary`

Same filters and shape as the dashboard, plus:

```json
{
  "sla": {
    "totalWithSla": 5,
    "openWithSla": 4,
    "overdue": 0,
    "approaching": 0,
    "onTimeDisposed": 1,
    "disposedWithSla": 1,
    "complianceRate": 100,
    "definition": "Deadline is slaDueDate, or nextActionDueDate when the SLA date is absent. Disposed cases are never overdue."
  },
  "alerts": [...]
}
```

### CSV exports

| Endpoint | Filters | Contents |
| --- | --- | --- |
| `GET /api/reports/export/cases` | `bureauId`, `regionId`, `categoryId`, `status`, `dateFrom`, `dateTo` | Case number, institution, category, priority, status, Bureau, officer, dates, resolution |
| `GET /api/reports/export/alerts` | `regionId`, `dateFrom`, `dateTo` | Alert type/status, institution, confidence, linked cases, evidence summary |
| `GET /api/reports/export/institutions` | `q`, `regionId` | Registry fields and case counts |

All exports are scope-filtered and use UTF-8 CSV with a BOM. Cells are quoted and formula-injection protected (`=`, `+`, `-`, `@`, tab and carriage return are prefixed). Responses set `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.

### `POST /api/reports/sla/evaluate`

`ADMIN` only. Runs the same evaluator as the 15-minute scheduler.

```json
{
  "result": {
    "evaluated": 4,
    "onTrack": 4,
    "approaching": 0,
    "overdue": 0,
    "escalationWarnings": 0,
    "notificationsCreated": 0
  }
}
```

Reminders are deduplicated per recipient by case, state and deadline date.

## Notifications

Notifications are always restricted to the authenticated user.

### `GET /api/notifications`

Filters: `unreadOnly=true`, `page`, `pageSize`. Response:

```json
{ "items": [...], "total": 13, "unreadCount": 8 }
```

### `GET /api/notifications/unread-count`

`{ "unreadCount": 8 }`.

### `POST /api/notifications/:id/read`

Marks one notification read. Returns `{ "success": true }`. An ID belonging to another user is not updated.

### `POST /api/notifications/read-all`

Marks every unread notification for the current user read. Returns `{ "success": true }`.

## Administration

Every endpoint in this section requires `ADMIN`. Responses never include password hashes.

### Users

- `GET /api/admin/users` — filters `q`, `role`, `isActive`, `page`, `pageSize`; returns `{ items, total }`
- `POST /api/admin/users` — `{ email, password, firstName, lastName, role, bureauId?, regionId?, isActive? }`; returns `201 { user }`
- `PATCH /api/admin/users/:id` — partial user fields plus optional `password`; returns `{ user }`

Role/scope rules:

- `BUREAU_OFFICER` requires an active Bureau.
- `REGIONAL_OFFICER` requires an active Region.
- Other roles cannot carry a Bureau or Region assignment.
- Administrators cannot change their own role or deactivate their own account.

### Bureaus

- `GET /api/admin/bureaus` → `{ bureaus }`
- `POST /api/admin/bureaus` → `201 { bureau }`
- `PATCH /api/admin/bureaus/:id` → `{ bureau }`

Body: `{ name, code, type, description?, isActive? }`; `type` is `REGULATION_BUREAU`, `PUBLIC_GRIEVANCE_REDRESSAL_CELL` or `OTHER`.

### Regions

- `GET /api/admin/regions` → `{ regions }`
- `POST /api/admin/regions` → `201 { region }`
- `PATCH /api/admin/regions/:id` → `{ region }`

Body: `{ name, code, states: string[], isActive? }`. States are stored comma-separated for SQLite portability.

### Categories

- `GET /api/admin/categories` → `{ categories }`
- `POST /api/admin/categories` → `201 { category }`
- `PATCH /api/admin/categories/:id` → `{ category }`

Body: `{ name, code, description?, isActive? }`.

### SLA rules

- `GET /api/admin/sla-rules` → `{ rules }` including the category relation
- `POST /api/admin/sla-rules` → `201 { rule }`
- `PATCH /api/admin/sla-rules/:id` → `{ rule }`

```json
{
  "name": "Academic compliance — 72 hours",
  "categoryId": "…",
  "bureauId": null,
  "priority": null,
  "slaDurationHours": 72,
  "warningThresholdHours": 24,
  "escalationThresholdHours": 12,
  "isActive": true
}
```

The most specific active rule wins: category (4) + Bureau (2) + priority (1), ties broken by newest rule. A rule with no selectors is the intentional global fallback.

### Audit trail

### `GET /api/admin/audit`

Filters: `action` (contains), `entityType` (exact), `entityId` (exact), `userId` (exact), `page`, `pageSize`.

Response: `{ "items": [...], "total": 1 }`. Each item includes the acting user summary and parsed `details`. Credentials and password hashes are never written to or returned from the audit trail.

## Access summary

| Capability | ADMIN | BUREAU_OFFICER | REGIONAL_OFFICER | SENIOR_MANAGEMENT | READ_ONLY |
| --- | --- | --- | --- | --- | --- |
| Read dashboard/cases/institutions/alerts | Yes | Scoped | Scoped | Yes | Yes |
| Create/modify cases | Yes | Own Bureau | Own Region | No | No |
| Review alerts | Yes | Scoped | Scoped | No | No |
| Create/update institutions and aliases | Yes | No | Own Region | No | No |
| Merge institutions | Yes | No | No | No | No |
| Resolve institution identity | Yes | No | Own Region | No | No |
| Run overlap/SLA evaluation | Yes | No | No | No | No |
| Export CSV | Yes | Scoped | Scoped | Yes | Yes |
| Admin users/policy/audit | Yes | No | No | No | No |
| Read own notifications | Yes | Yes | Yes | Yes | Yes |
