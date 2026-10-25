# Demonstration Walkthrough

A repeatable script for presenting the project to judges or reviewers. Every figure shown by the application comes from the SQLite database, and every workflow decision is enforced by the API.

> All institutions, complaints and accounts are synthetic and fictional. This is not a live AICTE system.

## 1. Prepare the environment

Prerequisites: Node.js 20.19+ (22/24 recommended) and npm 10+.

```bash
cd backend
npm install
cp .env.example .env
# Edit .env and set a long random JWT_SECRET. Keep DATABASE_URL="file:./dev.db".
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed
npm run dev
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The Vite proxy sends `/api` to `http://localhost:5000`, so the session cookie is first-party.

The seed is idempotent. Re-running `npm run prisma:seed` restores the demonstration state (including the pending identity request) without creating duplicates.

Expected seed summary:

| Record | Count |
| --- | --- |
| Users | 6 |
| Institutions | 2 |
| Cases | 5 |
| Overlap alerts | 2 |
| Identity resolutions | 1 (pending) |
| Notifications | 13 |
| Audit events | 1 |

Exact notification counts can vary if the SLA scheduler has run since seeding. The other counts should remain stable.

## 2. Accounts

All demo accounts use the password `Demo@123`.

| Role | Email | What it demonstrates |
| --- | --- | --- |
| Administrator | `admin@aicte-demo.gov.in` | Full workflow, identity resolution, administration |
| Bureau Officer | `rb.officer@aicte-demo.gov.in` | Regulation Bureau scope |
| Bureau Officer | `pgrc.officer@aicte-demo.gov.in` | Public Grievance Redressal Cell scope |
| Regional Officer | `regional.officer@aicte-demo.gov.in` | Northern Region only; can resolve identity |
| Senior Management | `senior@aicte-demo.gov.in` | Global read, no workflow writes |
| Read-only Viewer | `viewer@aicte-demo.gov.in` | Global read, no writes |

## 3. Seeded scenario

| Case | Bureau | Status | Purpose |
| --- | --- | --- | --- |
| `DEMO-COMP-2024-045` | PGRC | `UNDER_PROCESS` | Faculty shortage; one side of the cross-Bureau overlap |
| `DEMO-COMP-2024-052` | Regulation Bureau | `UNDER_REVIEW` | Approval-norm compliance; other side of the overlap |
| `DEMO-COMP-2024-058` | PGRC | `RECEIVED` | Similar complaint for duplicate suggestions |
| `DEMO-COMP-2024-061` | PGRC | `DISPOSED` | Disposed case; never counted as overdue |
| `DEMO-COMP-2024-066` | PGRC | `RECEIVED` | Pending identity request for “ABC Engineering Institute” |

Institutions: `ABC Engineering College` (`DEMO-123456`, Northern Region) and `XYZ Institute of Technology` (`DEMO-789012`, Southern Region).

## 4. Walkthrough

### Step 1 — Sign in and read the dashboard

1. Sign in as `admin@aicte-demo.gov.in`.
2. The dashboard shows totals, status counts, overdue/approaching cases, active alerts, pending identity requests, Bureau and region workload, category mix, ageing and the six-month trend.
3. Compare a number with the case register: open **Cases** and filter by the same status. The counts match because both use the same server-side scope and SLA policy.

Talking point: there are no hard-coded statistics and no privileged real-time socket. The UI refreshes authorized API data.

### Step 2 — Resolve an unverified institution identity

1. Open **Identity queue** (`/identity`).
2. The pending request for `DEMO-COMP-2024-066` is shown with the submitted name `ABC Engineering Institute`.
3. Open **Verify identity**. The explanation panel shows candidates with score and reasoning. The alias-like name is a suggestion, not an automatic link.
4. Select `ABC Engineering College (DEMO-123456)`, add a note such as “Confirmed against the AICTE permanent ID on the fee receipt”, and choose **Confirm identity**.
5. Open the linked case. The institution is now verified, the history contains `IDENTITY_RESOLVED`, and the institution detail metrics include the case.
6. Return to **Institutions → ABC Engineering College** and show that institution-level metrics now include four cases, including the newly resolved one.

Alternative: use **Dismiss request** with a note. The case remains unverified and is excluded from institution metrics. Both paths require a human decision and are audited.

### Step 3 — Inspect the institution record and case history

1. Open **Institutions** (`/institutions`) and search `DEMO-123456` or `ABC`.
2. Open the record. Show the permanent ID, aliases, region, consolidated case history, Bureau distribution, related alerts and SLA counts.
3. Open `DEMO-COMP-2024-052`. Show the SLA panel, linked alert, action history and the server-computed permission buttons.

### Step 4 — Demonstrate the ordinary lifecycle

1. Open `DEMO-COMP-2024-058`.
2. Choose **Change status** → `UNDER_REVIEW`. Add a remark and save.
3. Choose **Add action**, record “Institution contacted for records”, optionally set the next action and due date.
4. Choose **Change status** again. Only the next permitted ordinary targets are offered; transfer, escalation, disposal and reopening are not generic status choices.

Talking point: the server rejects `DISPOSED`, `TRANSFERRED`, `ESCALATED` and `REOPENED` through the generic status endpoint, so required evidence cannot be bypassed.

### Step 5 — Transfer with evidence, then dispose and reopen

1. On `DEMO-COMP-2024-058`, choose **Transfer**.
2. Select the Regulation Bureau, choose an officer, and enter a reason (at least 5 characters). Save.
3. The status becomes `TRANSFERRED`, the Bureau changes, the case remains open for SLA purposes, and the action history records the source/destination and reason.
4. As an officer who can modify the case, choose **Dispose**, enter meaningful resolution remarks (at least 10 characters), and save.
5. Show that the SLA state becomes `NONE` and the case is no longer counted as overdue.
6. Choose **Reopen**, enter a reason (at least 10 characters), and save. A new deadline is calculated from the reopen time and the previous resolution is retained in history.

### Step 6 — Review the cross-Bureau coordination alert

1. Open **Overlaps & duplicates** (`/overlaps`).
2. Open the `CROSS_BUREAU_OVERLAP` alert for ABC Engineering College.
3. Show the detection reason, structured evidence, stable alert key (`cross-bureau:<institutionId>`), linked cases from PGRC and the Regulation Bureau, and the existing review history.
4. Choose **Resolve alert**, enter an outcome such as “Both Bureaus confirmed separate grievances; coordination note shared and no duplicate action required”, and save.
5. The alert becomes terminal. Every linked case receives a coordination action, and the review history and audit trail retain the decision.
6. As an administrator, run **Evaluate now** on the overlaps page or `POST /api/alerts/evaluate/run`. Re-evaluation updates the existing alert identity instead of creating a duplicate. If the underlying overlap recurs after resolution, a new active record can appear, but history is preserved.

Show the potential-duplicate alert too. It is a review suggestion with a similarity score and evidence, not an automatic merge.

### Step 7 — SLA policy and evaluation

1. Open **Reports & analytics** (`/reports`).
2. Show overdue and approaching counts, disposal compliance, ageing and the shared SLA definition.
3. The same counts appear on the dashboard, the case register and case detail because all use `domain/slaPolicy.ts`.
4. As an administrator, choose **Run SLA evaluation**. The response reports evaluated, on-track, approaching, overdue and newly created notifications.
5. Run it again. Recipient-level deduplication means no duplicate reminder is created for the same case, state and deadline.

Seed rules:

| Rule | Scope | Duration | Warning | Escalation |
| --- | --- | --- | --- | --- |
| Academic Compliance SLA | Academic category | 72 hours | 24 hours | 12 hours |
| Standard Complaint SLA | Global fallback | 7 days | 72 hours | 24 hours |

These are illustrative, not official AICTE timelines. Administrators can manage them under **SLA policy** (`/admin/sla-rules`).

### Step 8 — Export data

1. On **Reports & analytics**, export cases, alerts and institutions.
2. Open a CSV. Headers, scope filtering and dates are present.
3. Show that a value beginning with `=`, `+`, `-` or `@` is prefixed with `'`, preventing spreadsheet formula injection.
4. Log in as a Regional officer and export again. Only Northern Region data is present.

### Step 9 — Notifications

1. Open **Notifications** (`/notifications`).
2. Filter to **Unread only**, mark one notification read, then use **Mark all read**.
3. The sidebar/top-bar badge updates after the action and on the 30-second authenticated refresh.
4. Sign in as another user and confirm that notifications are private to the recipient.

### Step 10 — Administration

As administrator:

1. **Users & access** (`/admin/users`): create or edit a user. Show that a Bureau officer requires an active Bureau, a Regional officer requires an active Region, and other roles cannot carry either scope. Show self-protection: you cannot change your own role or deactivate yourself.
2. **SLA policy** (`/admin/sla-rules`): create a more specific rule. Explain specificity: category (4) + Bureau (2) + priority (1), newest wins on a tie.
3. **Audit trail** (`/admin/audit`): filter by action or entity. Open a user update event and show that field names and role/scope are recorded, but never a password or hash.

### Step 11 — Prove authorization is server-side

1. Sign in as `viewer@aicte-demo.gov.in`.
2. **Register complaint** is absent, case action buttons are absent, and alert review controls are read-only.
3. Navigate directly to `/admin/users`. The client guard redirects to the dashboard.
4. The API still rejects a direct attempt. From a terminal, reuse the viewer session cookie:

```bash
curl -i -X POST http://localhost:5000/api/cases \
  -H "Content-Type: application/json" \
  -H "Cookie: aicte_session=<viewer-cookie>" \
  -d '{"institutionId":"<id>","title":"Direct write attempt","description":"This request should be rejected by the server.","categoryId":"<id>"}'
```

Expected: `403` with a structured error body.

5. Sign in as `rb.officer@aicte-demo.gov.in`. The case register is limited to Regulation Bureau cases plus cases linked through coordination alerts. PGRC-only cases remain hidden.
6. Sign in as `regional.officer@aicte-demo.gov.in` (Northern Region). Southern Region institution `XYZ Institute of Technology` is not visible, and an identity resolution cannot select an institution outside the region.
7. Sign in as `senior@aicte-demo.gov.in`. Global read works, but case and alert write controls are absent and the API rejects writes.

## 5. Reset the demo

Re-run the seed to restore the original scenario:

```bash
cd backend
npm run prisma:seed
```

This resets the pending identity request, case statuses and seeded alert review to the documented state. It does not delete unrelated records. To start from a completely empty database:

```bash
npx prisma migrate reset
npm run prisma:seed
```

`migrate reset` is destructive. Back up `backend/prisma/dev.db` first if you need to keep local data.

## 6. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Login succeeds but API calls return `401` | Ensure the frontend is opened at `http://localhost:5173` so the Vite proxy keeps the cookie first-party. Check `FRONTEND_URL` and the backend port. |
| `JWT_SECRET is not configured` | Set a non-empty `JWT_SECRET` in `backend/.env`. |
| No institution data | Run `npm run prisma:seed` and confirm the migration has been applied. |
| Dashboard numbers look stale | Use the page refresh button. The app polls authorized endpoints; it does not rely on a socket. |
| Seed counts differ | Confirm no second seed process is running and that `DATABASE_URL` points at `file:./dev.db`. |

## 7. Points to emphasise

1. **Stable institution identity** — exact AICTE ID or a recorded human decision; names never auto-link.
2. **One lifecycle policy** — special operations require their own evidence-bearing workflows.
3. **One SLA policy** — every screen and the scheduler agree; disposed cases are never overdue.
4. **Stable alert identities** — re-evaluation updates and reconciles, preserving history.
5. **Server-enforced authorization** — read-only and out-of-scope actions fail even when called directly.
6. **Idempotent notifications** — one event per recipient, safe to re-run.
7. **Data-driven reporting** — every figure comes from the database.
8. **Complete audit trail** — workflow actions, review decisions and administrative changes are recorded without credentials.
