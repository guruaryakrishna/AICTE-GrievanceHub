import { useState } from 'react';
import {
  ClipboardList,
  Eye,
  Filter,
  KeyRound,
  RefreshCw,
  Search,
  ScrollText,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import api from '../services/api';
import { useAsyncData } from '../hooks/useAsyncData';
import { formatDateTime, titleize } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatCard,
  cn,
} from '../components/ui';
import type { AdminUser, AuditEvent, Paginated } from '../services/types';

const ENTITY_TYPES = [
  'Case',
  'Institution',
  'InstitutionResolution',
  'OverlapAlert',
  'User',
  'SLARule',
  'Bureau',
  'Region',
  'ComplaintCategory',
] as const;

function actionTone(action: string): 'slate' | 'emerald' | 'blue' | 'teal' | 'amber' | 'red' | 'violet' {
  if (action === 'LOGIN' || action === 'LOGOUT') return 'slate';
  if (action.includes('MERGED') || action.includes('DISMISSED')) return 'violet';
  if (action.includes('DISPOSED') || action.includes('RESOLVED')) return 'emerald';
  if (action.includes('ESCALAT') || action.includes('OVERDUE')) return 'red';
  if (action.includes('CREATED')) return 'blue';
  if (action.includes('REVIEWED')) return 'teal';
  if (action.includes('UPDATED') || action.includes('CHANGED')) return 'amber';
  return 'slate';
}

function renderDetail(value: unknown): string {
  if (value === null || value === undefined) return 'No additional detail was recorded.';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function AuditLog() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [userId, setUserId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const events = useAsyncData<Paginated<AuditEvent>>(async () => {
    const params: Record<string, string | number> = { page, pageSize };
    if (action.trim()) params.action = action.trim();
    if (entityType) params.entityType = entityType;
    if (entityId.trim()) params.entityId = entityId.trim();
    if (userId) params.userId = userId;
    const response = await api.get('/admin/audit', { params });
    return response.data as Paginated<AuditEvent>;
  }, [action, entityType, entityId, userId, page, pageSize]);

  const users = useAsyncData<AdminUser[]>(async () => {
    const response = await api.get('/admin/users', { params: { pageSize: 100 } });
    return (response.data.items ?? []) as AdminUser[];
  }, []);

  const items = events.data?.items ?? [];
  const total = events.data?.total ?? 0;
  const distinctActions = new Set(items.map((event) => event.action)).size;
  const distinctActors = new Set(items.map((event) => event.userId ?? 'system')).size;

  const clearFilters = () => {
    setAction('');
    setEntityType('');
    setEntityId('');
    setUserId('');
    setPage(1);
  };

  const hasFilters = Boolean(action.trim() || entityType || entityId.trim() || userId);

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Audit trail"
        subtitle="Accountable record of access, case workflow, identity resolution and administrative changes. Passwords and other credentials are never stored in audit details."
        actions={
          <Button variant="outline" size="sm" onClick={() => events.reload()} loading={events.loading}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Events"
          value={events.data ? total : '—'}
          hint={hasFilters ? 'Matching current filters' : 'Whole audit trail'}
          icon={<ScrollText className="h-5 w-5" />}
        />
        <StatCard
          label="Action types"
          value={events.data ? distinctActions : '—'}
          hint="On this page"
          tone="info"
          icon={<ClipboardList className="h-5 w-5" />}
        />
        <StatCard
          label="Actors"
          value={events.data ? distinctActors : '—'}
          hint="On this page, including system"
          tone="success"
          icon={<UserRound className="h-5 w-5" />}
        />
        <StatCard
          label="Credentials"
          value="Never logged"
          hint="Sensitive values redacted by design"
          tone="warning"
          icon={<KeyRound className="h-5 w-5" />}
        />
      </div>

      <Card className="mb-5">
        <form
          className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-12"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
          }}
        >
          <Field label="Action" className="lg:col-span-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="pl-9"
                value={action}
                onChange={(event) => {
                  setAction(event.target.value);
                  setPage(1);
                }}
                placeholder="e.g. CASE_DISPOSED"
              />
            </div>
          </Field>
          <Field label="Entity type" className="lg:col-span-3">
            <Select
              value={entityType}
              onChange={(event) => {
                setEntityType(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All entity types</option>
              {ENTITY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Entity ID" className="lg:col-span-3">
            <Input
              value={entityId}
              onChange={(event) => {
                setEntityId(event.target.value);
                setPage(1);
              }}
              placeholder="Exact record identifier"
            />
          </Field>
          <Field label="Actor" className="lg:col-span-3">
            <Select
              value={userId}
              onChange={(event) => {
                setUserId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All actors</option>
              {(users.data ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.firstName} {user.lastName} ({user.email})
                </option>
              ))}
            </Select>
          </Field>
          {hasFilters && (
            <div className="flex items-end lg:col-span-12">
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <Filter className="h-4 w-4" /> Clear all filters
              </Button>
            </div>
          )}
        </form>
      </Card>

      {events.error ? (
        <Card>
          <ErrorBlock message={events.error} onRetry={events.reload} />
        </Card>
      ) : events.loading && !events.data ? (
        <Card>
          <LoadingBlock label="Loading audit events…" />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title="No audit events match these filters"
            message="Try a different action, entity type or actor. The audit trail is append-only and is never edited from this screen."
            icon={<ScrollText className="h-6 w-6" />}
          />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Recorded events"
            subtitle="Newest first. Select an event to inspect the stored detail payload."
            icon={<ShieldCheck className="h-4 w-4" />}
          />
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Timestamp</th>
                  <th className="px-5 py-3 font-semibold">Actor</th>
                  <th className="px-5 py-3 font-semibold">Action</th>
                  <th className="px-5 py-3 font-semibold">Entity</th>
                  <th className="px-5 py-3 font-semibold">Source</th>
                  <th className="px-5 py-3 text-right font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((event) => (
                  <tr key={event.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-600">
                      {formatDateTime(event.timestamp)}
                    </td>
                    <td className="px-5 py-3 text-xs">
                      {event.user ? (
                        <>
                          <p className="font-medium text-slate-800">
                            {event.user.firstName} {event.user.lastName}
                          </p>
                          <p className="text-slate-500">{titleize(event.user.role)}</p>
                        </>
                      ) : (
                        <span className="text-slate-400">System</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={actionTone(event.action)}>{titleize(event.action)}</Badge>
                    </td>
                    <td className="px-5 py-3 text-xs">
                      <p className="font-medium text-slate-800">{event.entityType}</p>
                      <p className="font-mono text-[11px] text-slate-500">{event.entityId}</p>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">
                      <p>{event.ipAddress ?? '—'}</p>
                      {event.userAgent && (
                        <p className="max-w-[14rem] truncate text-[11px] text-slate-400" title={event.userAgent}>
                          {event.userAgent}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setSelected(event)}>
                        <Eye className="h-4 w-4" /> View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </Card>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Audit event detail"
        description={selected ? `${titleize(selected.action)} · ${selected.entityType}` : undefined}
        size="lg"
        footer={
          <Button variant="outline" onClick={() => setSelected(null)}>
            Close
          </Button>
        }
      >
        {selected && (
          <div className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Timestamp</dt>
                <dd className="mt-0.5 text-sm text-slate-900">{formatDateTime(selected.timestamp)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Actor</dt>
                <dd className="mt-0.5 text-sm text-slate-900">
                  {selected.user
                    ? `${selected.user.firstName} ${selected.user.lastName} (${selected.user.email})`
                    : 'System'}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Entity</dt>
                <dd className="mt-0.5 text-sm text-slate-900">
                  {selected.entityType}
                  <span className="ml-2 font-mono text-xs text-slate-500">{selected.entityId}</span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Event ID</dt>
                <dd className="mt-0.5 font-mono text-xs text-slate-500">{selected.id}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">IP address</dt>
                <dd className="mt-0.5 text-sm text-slate-900">{selected.ipAddress ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">User agent</dt>
                <dd className="mt-0.5 break-words text-sm text-slate-900">{selected.userAgent ?? '—'}</dd>
              </div>
            </dl>

            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Recorded detail
              </p>
              <pre
                className={cn(
                  'max-h-80 overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-4 text-xs leading-5 text-slate-100',
                )}
              >
                {renderDetail(selected.details)}
              </pre>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                <KeyRound className="h-3.5 w-3.5" />
                Password hashes and credentials are never written to the audit trail.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
