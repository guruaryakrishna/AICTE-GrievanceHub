import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Filter,
  Network,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useAsyncData } from '../hooks/useAsyncData';
import { formatDate, formatDateTime, getErrorMessage, titleize } from '../lib/format';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  Select,
  StatCard,
  StatusBadge,
} from '../components/ui';
import type { AlertSummary, DashboardData, Paginated } from '../services/types';

const STATUS_OPTIONS = [
  ['NEW', 'New'],
  ['UNDER_REVIEW', 'Under review'],
  ['COORDINATION_REQUIRED', 'Coordination required'],
  ['RESOLVED', 'Resolved'],
  ['DISMISSED', 'Dismissed'],
] as const;

const TYPE_OPTIONS = [
  ['CROSS_BUREAU_OVERLAP', 'Cross-Bureau overlap'],
  ['POTENTIAL_DUPLICATE', 'Potential duplicate'],
] as const;

export default function Overlaps() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'ADMIN';

  const [draft, setDraft] = useState({ q: '', status: 'ACTIVE', alertType: '' });
  const [filters, setFilters] = useState(draft);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [evaluating, setEvaluating] = useState(false);

  const summary = useAsyncData(async () => {
    const response = await api.get('/dashboard');
    return (response.data as DashboardData).metrics;
  }, []);

  const list = useAsyncData<Paginated<AlertSummary>>(async () => {
    const params: Record<string, string | number> = { page, pageSize };
    if (filters.q) params.q = filters.q;
    if (filters.status === 'ACTIVE') {
      params.status = 'NEW,UNDER_REVIEW,COORDINATION_REQUIRED';
    } else if (filters.status) {
      params.status = filters.status;
    }
    if (filters.alertType) params.alertType = filters.alertType;
    const response = await api.get('/alerts', { params });
    return response.data as Paginated<AlertSummary>;
  }, [filters, page, pageSize]);

  const evaluate = async () => {
    setEvaluating(true);
    try {
      const response = await api.post('/alerts/evaluate/run');
      const result = response.data.result ?? {};
      toast.success(
        `Evaluation complete: ${result.created ?? 0} created, ${result.updated ?? 0} updated, ${
          result.merged ?? 0
        } merged, ${result.dismissedOrphans ?? 0} orphan(s) dismissed.`,
      );
      list.reload();
      summary.reload();
      window.dispatchEvent(new Event('aicte:refresh'));
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setEvaluating(false);
    }
  };

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    setFilters(draft);
    setPage(1);
  };

  const reset = () => {
    const cleared = { q: '', status: 'ACTIVE', alertType: '' };
    setDraft(cleared);
    setFilters(cleared);
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Coordination"
        title="Overlaps and duplicate signals"
        subtitle="Explainable cross-Bureau coordination alerts and duplicate candidates. Alerts are stable and deduplicated, and every review is recorded."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => list.reload()} loading={list.loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            {isAdmin && (
              <Button size="sm" onClick={evaluate} loading={evaluating}>
                <PlayCircle className="h-4 w-4" /> Evaluate now
              </Button>
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active alerts"
          value={summary.data?.activeAlerts ?? '—'}
          hint="Open coordination signals"
          tone="warning"
          icon={<ShieldAlert className="h-5 w-5" />}
        />
        <StatCard
          label="Need review"
          value={summary.data?.alertsRequiringReview ?? '—'}
          hint="New or under review"
          tone="danger"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <StatCard
          label="Duplicate candidates"
          value={summary.data?.duplicateAlerts ?? '—'}
          hint="Active duplicate signals"
          tone="info"
          icon={<Copy className="h-5 w-5" />}
        />
        <StatCard
          label="Decision required"
          value={summary.data?.alertsRequiringReview ?? '—'}
          hint="Resolve or dismiss with a reason"
          icon={<Network className="h-5 w-5" />}
        />
      </div>

      <Card className="mb-5">
        <form onSubmit={apply} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-12">
          <Field label="Search" className="lg:col-span-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="pl-9"
                value={draft.q}
                onChange={(event) => setDraft({ ...draft, q: event.target.value })}
                placeholder="Institution, AICTE ID or detection reason…"
              />
            </div>
          </Field>
          <Field label="Status" className="lg:col-span-3">
            <Select
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value })}
            >
              <option value="ACTIVE">Active only</option>
              {STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              <option value="">All statuses</option>
            </Select>
          </Field>
          <Field label="Alert type" className="lg:col-span-2">
            <Select
              value={draft.alertType}
              onChange={(event) => setDraft({ ...draft, alertType: event.target.value })}
            >
              <option value="">All types</option>
              {TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end gap-2 lg:col-span-2">
            <Button type="submit" className="flex-1">
              Apply
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              Clear
            </Button>
          </div>
        </form>
      </Card>

      {list.error ? (
        <Card>
          <ErrorBlock message={list.error} onRetry={list.reload} />
        </Card>
      ) : list.loading && !list.data ? (
        <Card>
          <LoadingBlock label="Loading coordination alerts…" />
        </Card>
      ) : !list.data || list.data.items.length === 0 ? (
        <Card>
          <EmptyState
            title="No alerts match these filters"
            message="Cross-Bureau overlaps and duplicate candidates appear here after evaluation. Adjust filters or run evaluation as an administrator."
            icon={<ShieldAlert className="h-6 w-6" />}
            action={
              isAdmin ? (
                <Button onClick={evaluate} loading={evaluating}>
                  <PlayCircle className="h-4 w-4" /> Evaluate overlaps
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.data.items.map((alert) => {
            const terminal = alert.status === 'RESOLVED' || alert.status === 'DISMISSED';
            return (
              <Card key={alert.id} className={terminal ? 'opacity-90' : undefined}>
                <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={alert.alertType === 'POTENTIAL_DUPLICATE' ? 'amber' : 'teal'}>
                        {alert.alertType === 'POTENTIAL_DUPLICATE' ? (
                          <Copy className="h-3 w-3" />
                        ) : (
                          <Network className="h-3 w-3" />
                        )}
                        {titleize(alert.alertType)}
                      </Badge>
                      <StatusBadge status={alert.status} />
                      {alert.status === 'RESOLVED' && (
                        <Badge tone="emerald">
                          <CheckCircle2 className="h-3 w-3" /> Closed
                        </Badge>
                      )}
                      {alert.status === 'DISMISSED' && (
                        <Badge tone="slate">
                          <XCircle className="h-3 w-3" /> Dismissed
                        </Badge>
                      )}
                      <span className="text-[11px] text-slate-400">
                        Detected {formatDate(alert.firstDetectedAt)} · re-evaluated{' '}
                        {formatDateTime(alert.lastEvaluatedAt)}
                      </span>
                    </div>

                    <div className="mt-2">
                      {alert.institution ? (
                        <Link
                          to={`/institutions/${alert.institution.id}`}
                          className="text-sm font-semibold text-slate-900 hover:text-primary-700 hover:underline"
                        >
                          {alert.institution.name}
                        </Link>
                      ) : (
                        <span className="text-sm font-semibold text-slate-900">Institution not recorded</span>
                      )}
                      <p className="text-xs text-slate-500">
                        {alert.institution?.aictePermanentId
                          ? `AICTE ID ${alert.institution.aictePermanentId}`
                          : 'No stable institution identity'}
                        {alert.institution?.state ? ` · ${alert.institution.state}` : ''}
                      </p>
                    </div>

                    <p className="mt-2 text-sm text-slate-700">{alert.detectionReason}</p>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {(alert.cases ?? []).map((link) => (
                        <Link
                          key={link.id}
                          to={`/cases/${link.caseId}`}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition hover:border-primary-300 hover:text-primary-700"
                        >
                          {link.case?.caseNumber ?? 'Case'}
                          {link.case?.currentBureau?.code ? ` · ${link.case.currentBureau.code}` : ''}
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      ))}
                    </div>

                    {alert.status === 'DISMISSED' && alert.dismissalReason && (
                      <p className="mt-2 text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">Dismissed:</span> {alert.dismissalReason}
                      </p>
                    )}
                    {alert.status === 'RESOLVED' && alert.resolutionOutcome && (
                      <p className="mt-2 text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">Outcome:</span> {alert.resolutionOutcome}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-stretch gap-2 lg:w-44">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <p>
                        <span className="font-semibold text-slate-800">{(alert.cases ?? []).length}</span> linked case(s)
                      </p>
                      {alert.confidence !== null && alert.confidence !== undefined && (
                        <p className="mt-1">
                          Confidence{' '}
                          <span className="font-semibold text-slate-800">
                            {Math.round(alert.confidence * 100)}%
                          </span>
                        </p>
                      )}
                      {alert.similarityScore !== null && alert.similarityScore !== undefined && (
                        <p>
                          Similarity{' '}
                          <span className="font-semibold text-slate-800">
                            {Math.round(alert.similarityScore * 100)}%
                          </span>
                        </p>
                      )}
                    </div>
                    <Link
                      to={`/overlaps/${alert.id}`}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary-700 px-3 text-xs font-semibold text-white transition hover:bg-primary-800"
                    >
                      Open alert <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              </Card>
            );
          })}

          <Card>
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
          </Card>
        </div>
      )}

      <div className="mt-5 flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
        <Filter className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p>
          Alert identities are stable: cross-Bureau alerts use one key per institution and duplicate alerts use the
          sorted case pair. Re-evaluation merges history into a canonical alert rather than creating duplicates.
        </p>
      </div>
    </div>
  );
}
