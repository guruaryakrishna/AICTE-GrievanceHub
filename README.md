# AICTE Integrated Institution Complaint Monitoring and Status Dashboard

A full-stack demonstration of a unified grievance platform for AICTE Bureaus and Cells. Complaints are tied to a stable institution identity, tracked through one authoritative lifecycle and SLA policy, and coordinated across Bureaus through explainable overlap alerts.

All bundled data is synthetic and fictional. This is a competition/demonstration build, not a production AICTE system.

## What the application does

- **Institution registry and identity resolution** — an exact AICTE Permanent ID links automatically; names and aliases only produce explainable candidates that require human review. An unresolved intake is tracked in an identity queue until an authorised officer confirms or dismisses it.
- **Complete complaint lifecycle** — ordinary review progression is separated from transfer, escalation, disposal and reopening workflows. Every transition is authorised server-side and recorded.
- **Cross-Bureau coordination** — deterministic overlap alerts use a stable key per institution. Potential duplicate complaints use an order-independent key per case pair. Re-evaluation merges history into a canonical alert instead of duplicating it.
- **One SLA policy** — the most specific active rule supplies the deadline duration and warning/escalation windows. The case list, detail view, dashboard, reports and scheduled evaluator all use the same calculation. Disposed cases are never overdue.
- **Server-backed notifications** — assignment, deadline, coordination and identity events are deduplicated per recipient using a composite unique key. The UI polls authorised endpoints; there is no privileged real-time socket.
- **Data-driven dashboard and reports** — metrics, workload, ageing, trends, SLA compliance and exports are computed from the database. There are no fabricated statistics.
- **Administration** — user role/scope validation, SLA policy management and an append-only audit trail that never records password hashes or credentials.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 3, React Router 7, Axios, Recharts, Lucide |
| Backend | Node.js, Express 5, TypeScript, Prisma 6, Zod |
| Database | SQLite (demonstration); PostgreSQL-compatible Prisma schema |
| Authentication | JWT in an HTTP-only cookie, bcrypt password hashing |
| Tests | Vitest + Supertest (backend), Vitest + Testing Library (frontend) |

## Prerequisites

- Node.js 20.19+ (Node 22/24 recommended)
- npm 10+
- No external database server is required for the demonstration build

## Quick start

```bash
# 1. Backend dependencies
cd backend
npm install

# 2. Environment
cp .env.example .env
# Set a long random JWT_SECRET. The SQLite defaults work as-is.

# 3. Schema and demonstration data
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed

# 4. Backend (http://localhost:5000)
npm run dev
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` to `http://localhost:5000`, so the browser uses same-origin requests and first-party session cookies. Set `VITE_API_URL` only when the API is served from a different origin.

### Re-running the seed

`npm run prisma:seed` is idempotent. It upserts by stable business keys, then runs the real overlap and SLA evaluators. Re-running it must not create duplicates and should report the same counts.

## Demonstration accounts

All accounts use the password `Demo@123`.

| Role | Email | Scope |
| --- | --- | --- |
| Administrator | `admin@aicte-demo.gov.in` | All AICTE |
| Bureau Officer | `rb.officer@aicte-demo.gov.in` | Regulation Bureau |
| Bureau Officer | `pgrc.officer@aicte-demo.gov.in` | Public Grievance Redressal Cell |
| Regional Officer | `regional.officer@aicte-demo.gov.in` | Northern Region |
| Senior Management | `senior@aicte-demo.gov.in` | All AICTE, read-only workflow |
| Read-only Viewer | `viewer@aicte-demo.gov.in` | All AICTE, read-only |

The seeded scenario uses `ABC Engineering College` (`DEMO-123456`) and `XYZ Institute of Technology` (`DEMO-789012`), with cases `DEMO-COMP-2024-045`, `052`, `058`, `061` and `066`. Case `066` starts with a pending identity request for `ABC Engineering Institute`.

## Verification

```bash
# Backend
cd backend
npx tsc --noEmit
npm run test:run
npx prisma validate
npx prisma migrate status

# Frontend
cd frontend
npx tsc -b
npm test
npm run lint
npm run build
```

The backend suite covers authentication, authorization, lifecycle policy, SLA policy, identity resolution, overlap reconciliation, notification deduplication, reports and administration. The frontend suite covers formatting, UI primitives, authentication state and the notification workflow.

## Project structure

```
PS-2/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts
│   ├── src/
│   │   ├── controllers/
│   │   ├── domain/            # lifecycle and SLA policy
│   │   ├── middleware/        # auth, security, errors
│   │   ├── services/          # case, identity, alerts, reports, notifications
│   │   │   └── matching/      # overlap keys and detection
│   │   ├── validators/
│   │   └── index.ts
│   └── tests/
├── frontend/
│   └── src/
│       ├── components/        # shared UI, toast, protected route
│       ├── contexts/
│       ├── hooks/
│       ├── layouts/
│       ├── lib/
│       ├── pages/
│       └── services/          # API client and response types
├── docs/
└── README.md
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API reference](docs/API.md)
- [Security](docs/SECURITY.md)
- [Demo walkthrough](docs/DEMO_WALKTHROUGH.md)
- [Implementation status](docs/IMPLEMENTATION_PLAN.md)

## Demonstration limitations

- SQLite is used for a self-contained demo. The Prisma schema can target PostgreSQL for production, but the bundled migrations are SQLite migrations.
- Notifications are in-app only; there is no email/SMS delivery.
- Matching is deterministic and rule-based. It does not call an external AI service.
- SLA durations in the seed are illustrative, not official AICTE timelines.
- The audit trail is append-only in application behaviour; production deployments should also enforce database-level immutability and retention.

## License

MIT
