import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Building2,
  CheckCircle2,
  Download,
  FileText,
  PlayCircle,
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
import { downloadBlob, formatDate, formatDateTime, getErrorMessage, percent, titleize } from '../lib/format';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DescriptionList,
  EmptyState,
  ErrorBlock,
  Field,
  InlineAlert,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  StatCard,
  StatusBadge,
  cn,
} from '../components/ui';
import type { Bureau, Category, Region, ReportSummary } from '../services/types';

const CHART_COLORS = ['#2563eb', '#0d9488', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#64748b'];

const EMPTY_FILTERS = {
  bureauId: '',
  regionId: '',
  categoryId: '',
  dateFrom: '',
  dateTo: '',
};

type Filters = typeof EMPTY_FILTERS;

interface ReportBundle {
  report: ReportSummary;
  bureaus: Bureau[];
  regions: Region[];
  categories: Category[];
}

export default function Reports() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'ADMIN';

  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [exporting, setExporting] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const data = useAsyncData<ReportBundle>(async () => {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(applied)) {
      if (value) params[key] = value;
    }
    const [report, bureaus, regions, categories] = await Promise.all([
      api.get('/reports/summary', { params }),
      api.get('/institutions/meta/bureaus'),
      api.get('/institutions/meta/regions'),
      api.get('/institutions/meta/categories'),
    ]);
    return {
      report: report.data as ReportSummary,
      bureaus: (bureaus.data.bureaus ?? []) as Bureau[],
      regions: (regions.data.regions ?? []) as Region[],
      categories: (categories.data.categories ?? []) as Category[],
    };
  }, [applied]);

  const report = data.data?.report;
  const metrics = report?.metrics;
  const sla = report?.sla;

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setApplied(draft);
  };

  const clearFilters = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  };

  const exportCsv = async (kind: 'cases' | 'alerts' | 'institutions') => {
    setExporting(kind);
    try {
      const params: Record<string, string> = {};
      if (applied.dateFrom) params.dateFrom = applied.dateFrom;
      if (applied.dateTo) params.dateTo = applied.dateTo;
      if (applied.regionId) params.regionId = applied.regionId;
      if (kind === 'cases') {
        if (applied.bureauId) params.bureauId = applied.bureauId;
        if (applied.categoryId) params.categoryId = applied.categoryId;
      }
      const response = await api.get(`/reports/export/${kind}`, { params, responseType: 'blob' });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(response.data, `aicte-${kind}-${stamp}.csv`);
      toast.success(`${titleize(kind)} export downloaded.`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setExporting(null);
    }
  };

  const runAdminAction = async (kind: 'sla' | 'overlaps') => {
    setRunning(kind);
    try {
      if (kind === 'sla') {
        const response = await api.post('/reports/sla/evaluate');
        const result = response.data.result ?? {};
        toast.success(
          `SLA evaluation complete: ${result.overdue ?? 0} overdue, ${result.approaching ?? 0} approaching, ${
            result.notificationsCreated ?? 0
          } reminder(s) queued.`,
        );
      } else {
        const response = await api.post('/alerts/evaluate/run');
        const result = response.data.result ?? {};
        toast.success(
          `Overlap evaluation complete: ${result.created ?? 0} created, ${result.updated ?? 0} updated, ${
            result.dismissedOrphans ?? 0
          } orphan(s) dismissed.`,
        );
      }
      data.reload();
      window.dispatchEvent(new Event('aicte:refresh'));
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setRunning(null);
    }
  };

  const statusData = (report?.statusDistribution ?? []).map((row) => ({
    name: titleize(row.status),
    value: row.count,
  }));
  const categoryTotal = (report?.categoryDistribution ?? []).reduce((sum, row) => sum + row.count, 0);
  const ageingTotal = (report?.ageing ?? []).reduce((sum, row) => sum + row.count, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Insights"
        title="Reports and analytics"
        subtitle="Every figure is computed from the database with the same scope, status and SLA definitions used by the case register."
        actions={
          <Button variant="outline" size="sm" onClick={data.reload} loading={data.loading}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      <Card className="mb-5">
        <form onSubmit={applyFilters} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Bureau / Cell">
            <Select
              value={draft.bureauId}
              onChange={(event) => setDraft({ ...draft, bureauId: event.target.value })}
            >
              <option value="">All bureaus</option>
              {(data.data?.bureaus ?? []).map((bureau) => (
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
              {(data.data?.regions ?? []).map((region) => (
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
              {(data.data?.categories ?? []).map((category) => (
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

      {data.error ? (
        <Card>
          <ErrorBlock message={data.error} onRetry={data.reload} />
        </Card>
      ) : data.loading && !report ? (
        <Card>
          <LoadingBlock label="Computing report summary…" />
        </Card>
      ) : report && metrics && sla ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <StatCard label="Total cases" value={metrics.totalCases} hint={`${percent(metrics.disposalRate, 1)} disposed`} icon={<FileText className="h-5 w-5" />} />
            <StatCard label="Open" value={metrics.pendingCases} hint={`${metrics.activeCases} actively in progress`} tone="info" icon={<Activity className="h-5 w-5" />} />
            <StatCard label="Overdue" value={sla.overdue} hint="Open cases past the shared deadline" tone="danger" icon={<Timer className="h-5 w-5" />} />
            <StatCard label="Approaching" value={sla.approaching} hint="Inside the warning window" tone="warning" icon={<ShieldAlert className="h-5 w-5" />} />
            <StatCard label="SLA compliance" value={percent(sla.complianceRate, 1)} hint={`${sla.onTimeDisposed} on time of ${sla.disposedWithSla} disposed with SLA`} tone="success" icon={<CheckCircle2 className="h-5 w-5" />} />
            <StatCard label="Avg disposal" value={`${metrics.avgDisposalDays} d`} hint="Receipt to disposal" icon={<TrendingUp className="h-5 w-5" />} />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Intake and disposal trend"
                subtitle="Last six months in the selected scope"
                icon={<TrendingUp className="h-4 w-4" />}
              />
              <div className="h-72 px-2 py-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.trends} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
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
              <CardHeader title="Status distribution" icon={<FileText className="h-4 w-4" />} />
              {statusData.length === 0 ? (
                <EmptyState title="No cases in scope" />
              ) : (
                <div className="h-72 px-2 py-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={82} paddingAngle={2}>
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
          </div>

          <Card className="border-primary-200">
            <CardHeader
              title="Shared SLA definition and compliance"
              subtitle="One policy across the dashboard, case register, detail pages and exports"
              icon={<Timer className="h-4 w-4" />}
              action={<Badge tone={sla.overdue > 0 ? 'red' : 'emerald'}>{sla.overdue > 0 ? 'Breaches present' : 'No open breach'}</Badge>}
            />
            <div className="grid gap-4 p-5 lg:grid-cols-2">
              <DescriptionList
                items={[
                  { label: 'Deadline authority', value: sla.definition },
                  { label: 'Cases with a deadline', value: sla.totalWithSla },
                  { label: 'Open cases with a deadline', value: sla.openWithSla },
                  { label: 'Disposed with a deadline', value: sla.disposedWithSla },
                  { label: 'On-time disposals', value: sla.onTimeDisposed },
                  { label: 'Compliance rate', value: percent(sla.complianceRate, 1) },
                ]}
              />
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">Rules applied everywhere</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>Open cases are overdue only when the deadline has passed.</li>
                  <li>Disposed cases are never counted as overdue, even after the original deadline.</li>
                  <li>Reopening restarts the SLA clock from the reopen decision.</li>
                  <li>The client never computes an authoritative deadline; it renders the server snapshot.</li>
                </ul>
                <p className="pt-1 text-[11px] text-slate-400">
                  Generated {formatDateTime(report.generatedAt)}.
                </p>
              </div>
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Bureau workload" subtitle="Open cases by Bureau / Cell" icon={<Building2 className="h-4 w-4" />} />
              {report.bureauWorkload.length === 0 ? (
                <EmptyState title="No open workload" />
              ) : (
                <div className="h-64 px-2 py-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={report.bureauWorkload} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
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
              <CardHeader title="Category mix" subtitle="All cases in scope" icon={<BarChart3 className="h-4 w-4" />} />
              <div className="space-y-3 p-5">
                {report.categoryDistribution.length === 0 ? (
                  <p className="text-sm text-slate-500">No data</p>
                ) : (
                  report.categoryDistribution.map((row) => {
                    const share = categoryTotal ? Math.round((row.count / categoryTotal) * 100) : 0;
                    return (
                      <div key={row.id}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="truncate text-slate-600">{row.name}</span>
                          <span className="ml-2 font-semibold text-slate-900">
                            {row.count} <span className="font-normal text-slate-400">({share}%)</span>
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                          <div className="h-1.5 rounded-full bg-primary-500" style={{ width: `${share}%` }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card>
              <CardHeader title="Ageing of open cases" icon={<Timer className="h-4 w-4" />} />
              <div className="space-y-3 p-5">
                {report.ageing.map((bucket) => {
                  const share = ageingTotal ? Math.round((bucket.count / ageingTotal) * 100) : 0;
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
                          style={{ width: `${share}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <CardHeader title="Regional workload" icon={<Building2 className="h-4 w-4" />} />
              <div className="divide-y divide-slate-100">
                {report.regionWorkload.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-slate-500">No regional workload.</p>
                ) : (
                  report.regionWorkload.map((row) => (
                    <div key={`${row.code}-${row.name}`} className="flex items-center justify-between px-5 py-3 text-sm">
                      <span className="text-slate-700">
                        {row.name} <span className="text-xs text-slate-400">({row.code})</span>
                      </span>
                      <span className="font-semibold text-slate-900">{row.activeCases}</span>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Top institutions" icon={<Building2 className="h-4 w-4" />} />
              <div className="divide-y divide-slate-100">
                {report.topInstitutions.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-slate-500">No verified institution cases.</p>
                ) : (
                  report.topInstitutions.map((row) => (
                    <Link
                      key={row.id}
                      to={`/institutions/${row.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 text-sm transition hover:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-800">{row.name}</span>
                        <span className="text-[11px] text-slate-400">AICTE ID {row.aictePermanentId}</span>
                      </span>
                      <span className="font-semibold text-slate-900">{row.count}</span>
                    </Link>
                  ))
                )}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Exports and scheduled evaluations"
              subtitle="CSV exports respect your authorised scope and the current filters where supported"
              icon={<Download className="h-4 w-4" />}
            />
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => exportCsv('cases')} loading={exporting === 'cases'}>
                  <Download className="h-4 w-4" /> Cases CSV
                </Button>
                <Button variant="outline" onClick={() => exportCsv('alerts')} loading={exporting === 'alerts'}>
                  <Download className="h-4 w-4" /> Alerts CSV
                </Button>
                <Button variant="outline" onClick={() => exportCsv('institutions')} loading={exporting === 'institutions'}>
                  <Download className="h-4 w-4" /> Institutions CSV
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                Exports neutralise spreadsheet formula injection and include only data visible to your role. Dates are
                rendered from server timestamps.
              </p>
              {isAdmin ? (
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  <Button variant="secondary" onClick={() => runAdminAction('sla')} loading={running === 'sla'}>
                    <Timer className="h-4 w-4" /> Run SLA evaluation
                  </Button>
                  <Button variant="secondary" onClick={() => runAdminAction('overlaps')} loading={running === 'overlaps'}>
                    <PlayCircle className="h-4 w-4" /> Evaluate overlaps
                  </Button>
                </div>
              ) : (
                <InlineAlert tone="info">
                  Scheduled evaluation actions are restricted to administrators. Reports and exports remain available
                  within your scope.
                </InlineAlert>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Coordination alerts in scope"
              subtitle={`${report.alerts.length} alert record(s) matched the report filters`}
              icon={<ShieldAlert className="h-4 w-4" />}
              action={
                <Link to="/overlaps" className="text-xs font-semibold text-primary-700 hover:underline">
                  Open alert register
                </Link>
              }
            />
            {report.alerts.length === 0 ? (
              <EmptyState title="No alerts in this scope" />
            ) : (
              <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {report.alerts.map((alert) => (
                  <Link
                    key={alert.id}
                    to={`/overlaps/${alert.id}`}
                    className="block px-5 py-3 transition hover:bg-slate-50"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={alert.status} />
                      <Badge tone={alert.alertType === 'POTENTIAL_DUPLICATE' ? 'amber' : 'teal'}>
                        {titleize(alert.alertType)}
                      </Badge>
                      <span className="text-[11px] text-slate-400">
                        {alert.institution?.name ?? 'Institution'} · detected {formatDate(alert.firstDetectedAt)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-600">{alert.detectionReason}</p>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <InlineAlert tone="info">
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              This report is generated live from {metrics.totalCases} case(s) in your scope. No statistic is fabricated or
              cached outside the database.
            </span>
          </InlineAlert>
        </div>
      ) : null}
    </div>
  );
}
