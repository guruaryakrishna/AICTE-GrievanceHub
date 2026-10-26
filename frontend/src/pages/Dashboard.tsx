import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  Fingerprint,
  Gauge,
  RefreshCw,
  ShieldAlert,
  Timer,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useAsyncData } from '../hooks/useAsyncData';
import { getErrorMessage, titleize } from '../lib/format';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBlock,
  Field,
  InlineAlert,
  Input,
  LoadingBlock,
  PageHeader,
  PriorityBadge,
  Select,
  SlaBadge,
  StatCard,
  StatusBadge,
  cn,
} from '../components/ui';
import type { Bureau, Category, DashboardData, Region } from '../services/types';

const CHART_COLORS = ['#2563eb', '#0d9488', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#64748b'];

const EMPTY_FILTERS = {
  bureauId: '',
  regionId: '',
  categoryId: '',
  dateFrom: '',
  dateTo: '',
};

type Filters = typeof EMPTY_FILTERS;

interface DashboardBundle {
  dashboard: DashboardData;
  bureaus: Bureau[];
  regions: Region[];
  categories: Category[];
}

export default function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [busy, setBusy] = useState<string | null>(null);
  const isAdmin = user?.role === 'ADMIN';

  const { data, loading, error, reload } = useAsyncData<DashboardBundle>(async () => {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(applied)) {
      if (value) params[key] = value;
    }
    const [dashboard, bureaus, regions, categories] = await Promise.all([
      api.get('/dashboard', { params }),
      api.get('/institutions/meta/bureaus'),
      api.get('/institutions/meta/regions'),
      api.get('/institutions/meta/categories'),
    ]);
    return {
      dashboard: dashboard.data as DashboardData,
      bureaus: (bureaus.data.bureaus ?? []) as Bureau[],
      regions: (regions.data.regions ?? []) as Region[],
      categories: (categories.data.categories ?? []) as Category[],
    };
  }, [applied]);

  const refreshEverything = () => {
    reload();
    window.dispatchEvent(new Event('aicte:refresh'));
  };

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setApplied(draft);
  };

  const clearFilters = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  };

  const runAction = async (kind: 'overlaps' | 'sla') => {
    setBusy(kind);
    try {
      if (kind === 'overlaps') {
        const response = await api.post('/alerts/evaluate/run');
        const result = response.data.result ?? {};
        toast.success(
          `Overlap evaluation complete: ${result.created ?? 0} created, ${result.updated ?? 0} updated, ${
            result.dismissedOrphans ?? 0
          } orphan(s) dismissed.`,
        );
      } else {
        const response = await api.post('/reports/sla/evaluate');
        const result = response.data.result ?? {};
        toast.success(
          `SLA evaluation complete: ${result.overdue ?? 0} overdue, ${result.approaching ?? 0} approaching, ${
            result.notificationsCreated ?? 0
          } reminder(s) queued.`,
        );
      }
      refreshEverything();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const dashboard = data?.dashboard;
  const metrics = dashboard?.metrics;
  const statusData = (dashboard?.statusDistribution ?? []).map((row) => ({
    name: titleize(row.status),
    value: row.count,
  }));
  const categoryTotal = (dashboard?.categoryDistribution ?? []).reduce((sum, row) => sum + row.count, 0);
  const ageingTotal = (dashboard?.ageing ?? []).reduce((sum, row) => sum + row.count, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Grievance command centre"
        subtitle="Live, server-computed workload, SLA exposure, identity gaps and cross-Bureau coordination signals."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refreshEverything} loading={loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            {isAdmin && (
              <>
                <Button variant="outline" size="sm" onClick={() => runAction('overlaps')} loading={busy === 'overlaps'}>
                  <ShieldAlert className="h-4 w-4" /> Evaluate overlaps
                </Button>
                <Button variant="outline" size="sm" onClick={() => runAction('sla')} loading={busy === 'sla'}>
                  <Timer className="h-4 w-4" /> Run SLA check
                </Button>
              </>
            )}
          </>
        }
      />

      <Card className="mb-5">
        <form onSubmit={applyFilters} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Bureau / Cell" className="lg:col-span-1">
            <Select
              value={draft.bureauId}
              onChange={(event) => setDraft({ ...draft, bureauId: event.target.value })}
            >
              <option value="">All bureaus</option>
              {(data?.bureaus ?? []).map((bureau) => (
                <option key={bureau.id} value={bureau.id}>
                  {bureau.code} · {bureau.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Region">
            <Select
              value={draft.regionId}
              onChange={(event) => setDraft({ ...draft, regionId: event.target.value })}
            >
              <option value="">All regions</option>
              {(data?.regions ?? []).map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category">
            <Select
              value={draft.categoryId}
              onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
            >
              <option value="">All categories</option>
              {(data?.categories ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Received from">
            <Input
              type="date"
              value={draft.dateFrom}
              onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })}
            />
          </Field>
          <Field label="Received to">
            <Input
              type="date"
              value={draft.dateTo}
              onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" className="flex-1">
              Apply
            </Button>
            <Button type="button" variant="ghost" onClick={clearFilters}>
              Reset
            </Button>
          </div>
        </form>
      </Card>

      {loading && !dashboard ? (
        <Card>
          <LoadingBlock label="Computing live dashboard…" />
        </Card>
      ) : error ? (
        <Card>
          <ErrorBlock message={error} onRetry={reload} />
        </Card>
      ) : dashboard && metrics ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <StatCard
              label="Total cases"
              value={metrics.totalCases}
              hint={`${metrics.disposalRate}% disposed`}
              icon={<FileText className="h-5 w-5" />}
            />
            <StatCard
              label="Open workload"
              value={metrics.pendingCases}
              hint={`${metrics.activeCases} actively in process`}
              tone="info"
              icon={<Activity className="h-5 w-5" />}
            />
            <StatCard
              label="Overdue"
              value={metrics.overdue}
              hint="Shared SLA policy"
              tone="danger"
              icon={<AlertTriangle className="h-5 w-5" />}
            />
            <StatCard
              label="Approaching deadline"
              value={metrics.approachingDeadline}
              hint="Inside warning window"
              tone="warning"
              icon={<Clock className="h-5 w-5" />}
            />
            <StatCard
              label="Alerts to review"
              value={metrics.alertsRequiringReview}
              hint={`${metrics.activeAlerts} active coordination alert(s)`}
              tone="warning"
              icon={<ShieldAlert className="h-5 w-5" />}
            />
            <StatCard
              label="Identity pending"
              value={metrics.pendingIdentityResolutions}
              hint="Unverified institution intake"
              tone="info"
              icon={<Fingerprint className="h-5 w-5" />}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <div className="space-y-5 xl:col-span-2">
              <Card>
                <CardHeader
                  title="Six-month intake and disposal trend"
                  subtitle="Derived from case receipt and disposal dates in your scope"
                  icon={<TrendingUp className="h-4 w-4" />}
                />
                <div className="h-64 px-2 py-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dashboard.trends} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0', fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="received" name="Received" fill="#2563eb" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="disposed" name="Disposed" fill="#0d9488" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Cases requiring attention"
                  subtitle="Open cases ordered by the nearest SLA deadline"
                  icon={<Timer className="h-4 w-4" />}
                  action={
                    <Link to="/cases?overdue=true" className="text-xs font-semibold text-primary-700 hover:underline">
                      View overdue cases
                    </Link>
                  }
                />
                {dashboard.urgentCases.length === 0 ? (
                  <EmptyState title="No open cases in this scope" message="Adjust the filters or register a new complaint." />
                ) : (
                  <div className="divide-y divide-slate-100">
                    {dashboard.urgentCases.map((item) => (
                      <Link
                        key={item.id}
                        to={`/cases/${item.id}`}
                        className="flex flex-col gap-2 px-5 py-3 transition hover:bg-slate-50 sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-primary-700">{item.caseNumber}</span>
                            <StatusBadge status={item.status} />
                            <PriorityBadge priority={item.priority} />
                          </div>
                          <p className="mt-1 truncate text-sm font-medium text-slate-900">{item.title}</p>
                          <p className="truncate text-xs text-slate-500">
                            {item.institution?.name ?? 'Institution not verified'} · {item.currentBureau?.code ?? 'No bureau'} ·{' '}
                            {item.category?.name ?? 'Uncategorised'}
                          </p>
                        </div>
                        <SlaBadge sla={item.sla} />
                      </Link>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            <div className="space-y-5">
              <Card>
                <CardHeader
                  title="Coordination signals"
                  subtitle={`${metrics.alertsRequiringReview} alert(s) need a human decision`}
                  icon={<ShieldAlert className="h-4 w-4" />}
                  action={
                    <Link to="/overlaps" className="text-xs font-semibold text-primary-700 hover:underline">
                      All alerts
                    </Link>
                  }
                />
                {dashboard.recentAlerts.length === 0 ? (
                  <EmptyState title="No active alerts" message="No cross-Bureau overlap or duplicate signal is open." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {dashboard.recentAlerts.map((alert) => (
                      <li key={alert.id}>
                        <Link to={`/overlaps/${alert.id}`} className="block px-5 py-3 transition hover:bg-slate-50">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={alert.status} />
                            <Badge tone={alert.alertType === 'POTENTIAL_DUPLICATE' ? 'amber' : 'teal'}>
                              {titleize(alert.alertType)}
                            </Badge>
                          </div>
                          <p className="mt-1.5 truncate text-sm font-medium text-slate-900">
                            {alert.institution?.name ?? 'Institution'}
                          </p>
                          <p className="line-clamp-2 text-xs text-slate-500">{alert.detectionReason}</p>
                          <p className="mt-1 text-[11px] text-slate-400">
                            {alert.cases?.length ?? 0} linked case(s)
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {metrics.pendingIdentityResolutions > 0 && (
                <Card className="border-amber-200 bg-amber-50/60">
                  <div className="flex items-start gap-3 p-5">
                    <div className="rounded-lg bg-amber-100 p-2 text-amber-700">
                      <Fingerprint className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-amber-900">Institution identity needs review</p>
                      <p className="mt-1 text-xs text-amber-800">
                        {metrics.pendingIdentityResolutions} intake record(s) cannot be trusted for institution metrics until
                        an authorised officer confirms the AICTE Permanent ID.
                      </p>
                      <Link
                        to="/identity"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-900 hover:underline"
                      >
                        Open identity queue <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                </Card>
              )}

              <Card>
                <CardHeader title="Case ageing" subtitle="Days since receipt for open cases" icon={<Gauge className="h-4 w-4" />} />
                <div className="space-y-3 p-5">
                  {dashboard.ageing.map((bucket) => {
                    const percent = ageingTotal ? Math.round((bucket.count / ageingTotal) * 100) : 0;
                    return (
                      <div key={bucket.bucket}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-600">{bucket.bucket}</span>
                          <span className="font-semibold text-slate-900">{bucket.count}</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                          <div
                            className={cn(
                              'h-1.5 rounded-full',
                              bucket.bucket === '60+ days' ? 'bg-red-500' : bucket.bucket === '31-60 days' ? 'bg-amber-500' : 'bg-accent-500',
                            )}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card>
              <CardHeader title="Status distribution" icon={<FileText className="h-4 w-4" />} />
              {statusData.length === 0 ? (
                <EmptyState title="No cases yet" />
              ) : (
                <div className="h-64 px-2 py-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={48}
                        outerRadius={82}
                        paddingAngle={2}
                      >
                        {statusData.map((entry, index) => (
                          <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0', fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader title="Bureau workload" subtitle="Open cases by Bureau / Cell" icon={<Building2 className="h-4 w-4" />} />
              {dashboard.bureauWorkload.length === 0 ? (
                <EmptyState title="No open workload" />
              ) : (
                <div className="h-64 px-2 py-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dashboard.bureauWorkload} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="code" width={48} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0', fontSize: 12 }} />
                      <Bar dataKey="activeCases" name="Open cases" fill="#0d9488" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader title="Category mix" subtitle="All cases in scope" icon={<Activity className="h-4 w-4" />} />
              <div className="space-y-3 p-5">
                {dashboard.categoryDistribution.length === 0 ? (
                  <p className="text-sm text-slate-500">No data</p>
                ) : (
                  dashboard.categoryDistribution.map((row) => {
                    const percent = categoryTotal ? Math.round((row.count / categoryTotal) * 100) : 0;
                    return (
                      <div key={row.id}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="truncate text-slate-600">{row.name}</span>
                          <span className="ml-2 font-semibold text-slate-900">
                            {row.count} <span className="font-normal text-slate-400">({percent}%)</span>
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                          <div className="h-1.5 rounded-full bg-primary-500" style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Regional workload" subtitle="Open cases by institution region" icon={<Building2 className="h-4 w-4" />} />
              {dashboard.regionWorkload.length === 0 ? (
                <EmptyState title="No regional workload" />
              ) : (
                <div className="divide-y divide-slate-100">
                  {dashboard.regionWorkload.map((row) => (
                    <div key={`${row.code}-${row.name}`} className="flex items-center justify-between px-5 py-3 text-sm">
                      <span className="text-slate-700">
                        {row.name} <span className="text-xs text-slate-400">({row.code})</span>
                      </span>
                      <span className="font-semibold text-slate-900">{row.activeCases}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <CardHeader title="Top institutions by case volume" icon={<Building2 className="h-4 w-4" />} />
              {dashboard.topInstitutions.length === 0 ? (
                <EmptyState title="No institution cases" />
              ) : (
                <div className="divide-y divide-slate-100">
                  {dashboard.topInstitutions.map((row) => (
                    <Link
                      key={row.id}
                      to={`/institutions/${row.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 text-sm transition hover:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-800">{row.name}</span>
                        <span className="text-[11px] text-slate-400">AICTE ID {row.aictePermanentId}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{row.count}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-300" />
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <InlineAlert tone="info">
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Every figure on this page is computed from the database using the same SLA policy as case lists, detail pages
              and reports. Deadline = <code className="rounded bg-white/60 px-1">slaDueDate</code> with{' '}
              <code className="rounded bg-white/60 px-1">nextActionDueDate</code> as the documented fallback; disposed cases
              are never overdue. Generated {new Date(dashboard.generatedAt).toLocaleString('en-IN')}.
            </span>
          </InlineAlert>
        </div>
      ) : null}
    </div>
  );
}
