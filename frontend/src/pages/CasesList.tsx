import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  PlusCircle,
  RefreshCw,
  Search,
  SlidersHorizontal,
  User,
} from 'lucide-react';
import api from '../services/api';
import { useAuth, isWritableRole } from '../contexts/AuthContext';
import { useAsyncData } from '../hooks/useAsyncData';
import { formatDate, titleize } from '../lib/format';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  PriorityBadge,
  Select,
  SlaBadge,
  StatCard,
  StatusBadge,
} from '../components/ui';
import type { Bureau, CaseRecord, Category, Paginated } from '../services/types';

interface Filters {
  q: string;
  status: string;
  priority: string;
  bureauId: string;
  categoryId: string;
  overdue: boolean;
  sort: string;
}

const STATUS_OPTIONS = [
  ['RECEIVED', 'Received'],
  ['UNDER_REVIEW', 'Under review'],
  ['UNDER_PROCESS', 'Under process'],
  ['TRANSFERRED', 'Transferred'],
  ['ESCALATED', 'Escalated'],
  ['DISPOSED', 'Disposed'],
  ['REOPENED', 'Reopened'],
] as const;

const PRIORITY_OPTIONS = [
  ['LOW', 'Low'],
  ['MEDIUM', 'Medium'],
  ['HIGH', 'High'],
  ['URGENT', 'Urgent'],
] as const;

const SORT_OPTIONS = [
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['due-asc', 'Deadline: soonest'],
  ['due-desc', 'Deadline: latest'],
  ['case-asc', 'Case number A–Z'],
] as const;

export default function CasesList() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canCreate = isWritableRole(user?.role);

  const [filters, setFilters] = useState<Filters>(() => ({
    q: searchParams.get('q') ?? '',
    status: searchParams.get('status') ?? '',
    priority: searchParams.get('priority') ?? '',
    bureauId: searchParams.get('bureauId') ?? '',
    categoryId: searchParams.get('categoryId') ?? '',
    overdue: searchParams.get('overdue') === 'true',
    sort: 'newest',
  }));
  const [draft, setDraft] = useState<Filters>(filters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const meta = useAsyncData(async () => {
    const [bureaus, categories] = await Promise.all([
      api.get('/institutions/meta/bureaus'),
      api.get('/institutions/meta/categories'),
    ]);
    return {
      bureaus: (bureaus.data.bureaus ?? []) as Bureau[],
      categories: (categories.data.categories ?? []) as Category[],
    };
  }, []);

  const summary = useAsyncData(async () => {
    const response = await api.get('/dashboard');
    return response.data.quickStats as {
      total: number;
      pending: number;
      active: number;
      disposed: number;
      overdue: number;
      approaching: number;
    };
  }, []);

  const list = useAsyncData<Paginated<CaseRecord>>(async () => {
    const params: Record<string, string | number | boolean> = { page, pageSize };
    if (filters.q) params.q = filters.q;
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.bureauId) params.bureauId = filters.bureauId;
    if (filters.categoryId) params.categoryId = filters.categoryId;
    if (filters.overdue) params.overdue = true;
    if (filters.sort === 'newest') {
      params.sortBy = 'createdAt';
      params.sortOrder = 'desc';
    } else if (filters.sort === 'oldest') {
      params.sortBy = 'createdAt';
      params.sortOrder = 'asc';
    } else if (filters.sort === 'due-asc') {
      params.sortBy = 'slaDueDate';
      params.sortOrder = 'asc';
    } else if (filters.sort === 'due-desc') {
      params.sortBy = 'slaDueDate';
      params.sortOrder = 'desc';
    } else {
      params.sortBy = 'caseNumber';
      params.sortOrder = 'asc';
    }
    const response = await api.get('/cases', { params });
    return response.data as Paginated<CaseRecord>;
  }, [filters, page, pageSize]);

  const activeFilterCount = [
    filters.q,
    filters.status,
    filters.priority,
    filters.bureauId,
    filters.categoryId,
    filters.overdue ? 'overdue' : '',
  ].filter(Boolean).length;

  const apply = (event?: React.FormEvent) => {
    event?.preventDefault();
    setFilters(draft);
    setPage(1);
    const next = new URLSearchParams();
    if (draft.q) next.set('q', draft.q);
    if (draft.status) next.set('status', draft.status);
    if (draft.priority) next.set('priority', draft.priority);
    if (draft.bureauId) next.set('bureauId', draft.bureauId);
    if (draft.categoryId) next.set('categoryId', draft.categoryId);
    if (draft.overdue) next.set('overdue', 'true');
    setSearchParams(next, { replace: true });
  };

  const reset = () => {
    const cleared: Filters = {
      q: '',
      status: '',
      priority: '',
      bureauId: '',
      categoryId: '',
      overdue: false,
      sort: 'newest',
    };
    setDraft(cleared);
    setFilters(cleared);
    setPage(1);
    setSearchParams({}, { replace: true });
  };

  const refresh = () => {
    list.reload();
    summary.reload();
  };

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Complaint case register"
        subtitle="Every complaint in your authorised scope, with lifecycle state, ownership and the shared SLA deadline."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refresh} loading={list.loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            {canCreate && (
              <Link
                to="/cases/create"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-700 px-3 text-xs font-semibold text-white transition hover:bg-primary-800"
              >
                <PlusCircle className="h-4 w-4" /> Register complaint
              </Link>
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total in scope" value={summary.data?.total ?? list.data?.total ?? 0} icon={<FileText className="h-5 w-5" />} />
        <StatCard
          label="Open"
          value={summary.data?.pending ?? '—'}
          hint={`${summary.data?.active ?? 0} actively in progress`}
          tone="info"
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          label="Overdue"
          value={summary.data?.overdue ?? '—'}
          hint="Never counts disposed cases"
          tone="danger"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <StatCard
          label="Disposed"
          value={summary.data?.disposed ?? '—'}
          hint={`${summary.data?.approaching ?? 0} approaching deadline`}
          tone="success"
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
      </div>

      <Card className="mb-5">
        <form onSubmit={apply} className="space-y-4 p-4">
          <div className="grid gap-3 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <Field label="Search">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    className="pl-9"
                    placeholder="Case number, title, institution, AICTE ID…"
                    value={draft.q}
                    onChange={(event) => setDraft({ ...draft, q: event.target.value })}
                  />
                </div>
              </Field>
            </div>
            <div className="lg:col-span-2">
              <Field label="Status">
                <Select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="lg:col-span-2">
              <Field label="Priority">
                <Select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })}>
                  <option value="">All priorities</option>
                  {PRIORITY_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="lg:col-span-2">
              <Field label="Bureau / Cell">
                <Select value={draft.bureauId} onChange={(event) => setDraft({ ...draft, bureauId: event.target.value })}>
                  <option value="">All bureaus</option>
                  {(meta.data?.bureaus ?? []).map((bureau) => (
                    <option key={bureau.id} value={bureau.id}>
                      {bureau.code} · {bureau.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="lg:col-span-2">
              <Field label="Category">
                <Select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}>
                  <option value="">All categories</option>
                  {(meta.data?.categories ?? []).map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <Checkbox
                label="Overdue only"
                checked={draft.overdue}
                onChange={(event) => setDraft({ ...draft, overdue: event.target.checked })}
              />
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <Select
                  className="h-8 w-44 py-1 text-xs"
                  value={draft.sort}
                  onChange={(event) => setDraft({ ...draft, sort: event.target.value })}
                  aria-label="Sort cases"
                >
                  {SORT_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              {activeFilterCount > 0 && (
                <span className="text-xs text-slate-500">
                  <Filter className="mr-1 inline h-3.5 w-3.5" />
                  {activeFilterCount} filter(s) active
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={reset}>
                Clear
              </Button>
              <Button type="submit" loading={list.loading}>
                Apply filters
              </Button>
            </div>
          </div>
        </form>
      </Card>

      <Card>
        {list.error ? (
          <ErrorBlock message={list.error} onRetry={list.reload} />
        ) : list.loading && !list.data ? (
          <LoadingBlock label="Loading cases…" />
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState
            title="No cases match these filters"
            message="Clear filters or register a new complaint to get started."
            icon={<FileText className="h-6 w-6" />}
            action={
              <Button variant="outline" onClick={reset}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1050px] divide-y divide-slate-100 text-left">
                <thead className="bg-slate-50/80">
                  <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 font-semibold">Case</th>
                    <th className="px-4 py-3 font-semibold">Institution</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Priority</th>
                    <th className="px-4 py-3 font-semibold">SLA</th>
                    <th className="px-4 py-3 font-semibold">Bureau</th>
                    <th className="px-4 py-3 font-semibold">Owner</th>
                    <th className="px-4 py-3 font-semibold">Received</th>
                    <th className="px-4 py-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.data.items.map((item) => (
                    <tr key={item.id} className="align-top transition hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <Link to={`/cases/${item.id}`} className="text-xs font-bold text-primary-700 hover:underline">
                          {item.caseNumber}
                        </Link>
                        <p className="mt-0.5 max-w-[260px] truncate text-sm font-medium text-slate-900" title={item.title}>
                          {item.title}
                        </p>
                        <p className="text-[11px] text-slate-500">{item.category?.name ?? 'Uncategorised'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-1.5">
                          <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <div className="min-w-0">
                            <p className="max-w-[190px] truncate text-xs text-slate-800">
                              {item.institution?.name ?? item.originalInstitutionName ?? 'Unverified'}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {item.institution?.aictePermanentId ?? 'Identity pending'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-3">
                        <PriorityBadge priority={item.priority} />
                      </td>
                      <td className="px-4 py-3">
                        <SlaBadge sla={item.sla} />
                        <p className="mt-1 text-[11px] text-slate-400">{formatDate(item.sla?.dueAt)}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        <span className="font-medium">{item.currentBureau?.code ?? '—'}</span>
                        <p className="max-w-[120px] truncate text-[11px] text-slate-400">
                          {item.currentBureau?.name ?? 'Unassigned'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-xs text-slate-700">
                          <User className="h-3.5 w-3.5 text-slate-400" />
                          {item.assignedOfficer
                            ? `${item.assignedOfficer.firstName} ${item.assignedOfficer.lastName}`
                            : 'Unassigned'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                          {formatDate(item.dateReceived)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/cases/${item.id}`}
                          className="text-xs font-semibold text-primary-700 hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 lg:hidden">
              {list.data.items.map((item) => (
                <Link key={item.id} to={`/cases/${item.id}`} className="block p-4 transition hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-primary-700">{item.caseNumber}</p>
                      <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{item.title}</p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-slate-600">
                    <p className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5 text-slate-400" />
                      {item.institution?.name ?? item.originalInstitutionName ?? 'Unverified institution'}
                    </p>
                    <p className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-slate-400" />
                      {item.assignedOfficer
                        ? `${item.assignedOfficer.firstName} ${item.assignedOfficer.lastName}`
                        : 'Unassigned'}
                      <span className="text-slate-300">·</span>
                      {titleize(item.priority)}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <SlaBadge sla={item.sla} />
                      <span className="flex items-center gap-1 text-[11px] text-slate-500">
                        <CalendarDays className="h-3 w-3" /> {formatDate(item.dateReceived)}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            <Pagination
              page={page}
              pageSize={pageSize}
              total={list.data.total}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
