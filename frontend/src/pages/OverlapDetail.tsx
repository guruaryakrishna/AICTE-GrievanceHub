import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Copy,
  History,
  Network,
  RefreshCw,
  Scale,
  ShieldAlert,
  UserCheck,
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
  CardHeader,
  DescriptionList,
  EmptyState,
  ErrorBlock,
  Field,
  InlineAlert,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
} from '../components/ui';
import type { AlertSummary, OfficerRef } from '../services/types';

const TRANSITIONS: Record<string, string[]> = {
  NEW: ['UNDER_REVIEW', 'COORDINATION_REQUIRED', 'RESOLVED', 'DISMISSED'],
  UNDER_REVIEW: ['COORDINATION_REQUIRED', 'RESOLVED', 'DISMISSED'],
  COORDINATION_REQUIRED: ['UNDER_REVIEW', 'RESOLVED', 'DISMISSED'],
  RESOLVED: [],
  DISMISSED: [],
};

const STATUS_LABELS: Record<string, string> = {
  UNDER_REVIEW: 'Under review',
  COORDINATION_REQUIRED: 'Coordination required',
  RESOLVED: 'Resolve alert',
  DISMISSED: 'Dismiss as false positive',
};

function EvidenceView({ evidence }: { evidence: unknown }) {
  if (evidence === null || evidence === undefined) {
    return <p className="text-sm text-slate-500">No structured evidence was recorded for this alert.</p>;
  }
  const items = Array.isArray(evidence)
    ? (evidence as { type?: string; detail?: string; [key: string]: unknown }[])
    : null;
  if (items) {
    return (
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-semibold text-slate-800">{titleize(item.type ?? 'Evidence')}</p>
            {item.detail && <p className="mt-1 text-xs text-slate-600">{item.detail}</p>}
            {!item.detail && (
              <pre className="mt-1 overflow-x-auto text-[10px] leading-4 text-slate-500">
                {JSON.stringify(item, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-[11px] leading-5 text-slate-600">
      {JSON.stringify(evidence, null, 2)}
    </pre>
  );
}

export default function OverlapDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const canReview = Boolean(user && !['READ_ONLY', 'SENIOR_MANAGEMENT'].includes(user.role));

  const [reviewOpen, setReviewOpen] = useState(false);
  const [form, setForm] = useState({
    status: '',
    remarks: '',
    outcome: '',
    dismissalReason: '',
    assignedCoordinatorId: '',
  });
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  const detail = useAsyncData(async () => {
    const response = await api.get(`/alerts/${id}`);
    return response.data.alert as AlertSummary;
  }, [id]);

  const officers = useAsyncData(async () => {
    if (!detail.data) return [] as OfficerRef[];
    const response = await api.get('/cases/meta/officers');
    return (response.data.officers ?? []) as OfficerRef[];
  }, [detail.data?.id]);

  const alert = detail.data;
  const transitions = alert ? TRANSITIONS[alert.status] ?? [] : [];
  const terminal = alert ? alert.status === 'RESOLVED' || alert.status === 'DISMISSED' : false;

  const openReview = (status?: string) => {
    if (!alert) return;
    setForm({
      status: status ?? transitions[0] ?? '',
      remarks: '',
      outcome: '',
      dismissalReason: '',
      assignedCoordinatorId: alert.assignedCoordinatorId ?? '',
    });
    setModalError('');
    setReviewOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.status) {
      setModalError('Select the review outcome.');
      return;
    }
    if (form.status === 'RESOLVED' && form.outcome.trim().length < 3) {
      setModalError('A resolution outcome is required.');
      return;
    }
    if (form.status === 'DISMISSED' && form.dismissalReason.trim().length < 3) {
      setModalError('A dismissal reason is required.');
      return;
    }
    setBusy(true);
    setModalError('');
    try {
      await api.post(`/alerts/${id}/review`, {
        status: form.status,
        remarks: form.remarks.trim() || null,
        outcome: form.status === 'RESOLVED' ? form.outcome.trim() : null,
        dismissalReason: form.status === 'DISMISSED' ? form.dismissalReason.trim() : null,
        assignedCoordinatorId: form.assignedCoordinatorId || null,
      });
      toast.success(`Alert moved to ${titleize(form.status)}. Linked cases received a coordination action.`);
      setReviewOpen(false);
      detail.reload();
      window.dispatchEvent(new Event('aicte:refresh'));
    } catch (error) {
      setModalError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (detail.error) {
    return (
      <Card>
        <ErrorBlock message={detail.error} onRetry={detail.reload} />
      </Card>
    );
  }

  if (detail.loading && !alert) {
    return (
      <Card>
        <LoadingBlock label="Loading coordination alert…" />
      </Card>
    );
  }

  if (!alert) {
    return (
      <Card>
        <EmptyState
          title="Alert not found"
          message="The alert may have been merged into a canonical record or is outside your authorised scope."
          action={
            <Button variant="outline" onClick={() => navigate('/overlaps')}>
              Back to alerts
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <Link to="/overlaps" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-700 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to overlaps and duplicates
        </Link>
      </div>

      <PageHeader
        eyebrow="Coordination alert"
        title={titleize(alert.alertType)}
        subtitle={alert.institution ? `${alert.institution.name} · AICTE ID ${alert.institution.aictePermanentId}` : 'Institution identity not recorded'}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={detail.reload} loading={detail.loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            {canReview && !terminal && (
              <Button variant="secondary" size="sm" onClick={() => openReview()}>
                <ClipboardList className="h-4 w-4" /> Record review
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={alert.alertType === 'POTENTIAL_DUPLICATE' ? 'amber' : 'teal'}>
          {alert.alertType === 'POTENTIAL_DUPLICATE' ? <Copy className="h-3 w-3" /> : <Network className="h-3 w-3" />}
          {titleize(alert.alertType)}
        </Badge>
        <StatusBadge status={alert.status} />
        {alert.confidence !== null && alert.confidence !== undefined && (
          <Badge tone="blue">Confidence {Math.round(alert.confidence * 100)}%</Badge>
        )}
        {alert.similarityScore !== null && alert.similarityScore !== undefined && (
          <Badge tone="blue">Similarity {Math.round(alert.similarityScore * 100)}%</Badge>
        )}
        {terminal && (
          <Badge tone={alert.status === 'RESOLVED' ? 'emerald' : 'slate'}>
            {alert.status === 'RESOLVED' ? <CheckCircle2 className="h-3 w-3" /> : <Scale className="h-3 w-3" />}
            Terminal — no further transition
          </Badge>
        )}
      </div>

      {!canReview && (
        <InlineAlert tone="info" className="mb-5">
          Your role can read this alert but cannot review it. Administrators, Bureau officers and Regional officers can
          record a decision.
        </InlineAlert>
      )}

      {alert.status === 'DISMISSED' && alert.dismissalReason && (
        <InlineAlert tone="warning" title="Dismissed as a false positive" className="mb-5">
          {alert.dismissalReason}
        </InlineAlert>
      )}
      {alert.status === 'RESOLVED' && alert.resolutionOutcome && (
        <InlineAlert tone="success" title="Resolved coordination alert" className="mb-5">
          {alert.resolutionOutcome}
        </InlineAlert>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Detection reason and evidence" icon={<ShieldAlert className="h-4 w-4" />} />
            <div className="space-y-4 p-5">
              <p className="text-sm leading-6 text-slate-700">{alert.detectionReason}</p>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Evidence</p>
                <EvidenceView evidence={alert.evidence} />
              </div>
              <DescriptionList
                columns={3}
                items={[
                  { label: 'First detected', value: formatDateTime(alert.firstDetectedAt) },
                  { label: 'Last evaluated', value: formatDateTime(alert.lastEvaluatedAt) },
                  { label: 'Stable alert key', value: alert.caseKey ?? '—' },
                  {
                    label: 'Assigned coordinator',
                    value: (officers.data ?? []).find((officer) => officer.id === alert.assignedCoordinatorId)
                      ? `${(officers.data ?? []).find((officer) => officer.id === alert.assignedCoordinatorId)?.firstName} ${
                          (officers.data ?? []).find((officer) => officer.id === alert.assignedCoordinatorId)?.lastName
                        }`
                      : alert.assignedCoordinatorId ?? 'Not assigned',
                  },
                  {
                    label: 'Resolved at',
                    value: alert.resolvedAt ? formatDateTime(alert.resolvedAt) : '—',
                  },
                  {
                    label: 'Institution',
                    value: alert.institution ? (
                      <Link
                        to={`/institutions/${alert.institution.id}`}
                        className="font-semibold text-primary-700 hover:underline"
                      >
                        {alert.institution.name}
                      </Link>
                    ) : (
                      '—'
                    ),
                  },
                ]}
              />
              {alert.reviewerRemarks && (
                <InlineAlert tone="info" title="Latest reviewer remarks">
                  {alert.reviewerRemarks}
                </InlineAlert>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Linked cases"
              subtitle="Each case receives the coordination action in its immutable history"
              icon={<ClipboardList className="h-4 w-4" />}
              action={<Badge tone="slate">{alert.cases?.length ?? 0}</Badge>}
            />
            {!alert.cases || alert.cases.length === 0 ? (
              <EmptyState title="No cases linked" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {alert.cases.map((link) => (
                  <li key={link.id} className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/cases/${link.caseId}`}
                        className="text-xs font-bold text-primary-700 hover:underline"
                      >
                        {link.case?.caseNumber ?? 'Case'}
                      </Link>
                      {link.case?.status && <StatusBadge status={link.case.status} />}
                      {link.case?.currentBureau && <Badge tone="blue">{link.case.currentBureau.code}</Badge>}
                      {link.case?.category && <Badge tone="slate">{link.case.category.name}</Badge>}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{link.case?.title ?? 'Case detail'}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {link.case?.assignedOfficer
                        ? `Owner: ${link.case.assignedOfficer.firstName} ${link.case.assignedOfficer.lastName}`
                        : 'Unassigned'}
                      {link.case?.currentBureau ? ` · ${link.case.currentBureau.name}` : ''}
                    </p>
                    {link.case?.actionHistory && link.case.actionHistory.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] font-medium text-slate-400 hover:text-slate-600">
                          Recent case actions ({link.case.actionHistory.length})
                        </summary>
                        <ul className="mt-1 space-y-1">
                          {link.case.actionHistory.slice(0, 5).map((action) => (
                            <li key={action.id} className="text-[11px] text-slate-600">
                              <span className="font-semibold">{titleize(action.actionType)}</span> ·{' '}
                              {formatDateTime(action.timestamp)}
                              {action.remarks ? ` — ${action.remarks}` : ''}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <Link
                      to={`/cases/${link.caseId}`}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline"
                    >
                      Open full case <ArrowRight className="h-3 w-3" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Review history"
              subtitle="Immutable record of every decision"
              icon={<History className="h-4 w-4" />}
              action={<Badge tone="slate">{alert.reviews?.length ?? 0}</Badge>}
            />
            {!alert.reviews || alert.reviews.length === 0 ? (
              <EmptyState title="No reviews recorded" message="The alert is still awaiting a human decision." />
            ) : (
              <ol className="divide-y divide-slate-100">
                {alert.reviews.map((review) => (
                  <li key={review.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={review.action} />
                        <span className="text-xs font-semibold text-slate-800">
                          {review.reviewedBy
                            ? `${review.reviewedBy.firstName} ${review.reviewedBy.lastName}`
                            : 'System'}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500">{formatDateTime(review.timestamp)}</span>
                    </div>
                    {review.outcome && <p className="mt-1 text-sm text-slate-700">{review.outcome}</p>}
                    {review.remarks && <p className="mt-1 text-xs text-slate-600">{review.remarks}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Review decision" icon={<Scale className="h-4 w-4" />} />
            <div className="space-y-3 p-5">
              {terminal ? (
                <>
                  <InlineAlert tone={alert.status === 'RESOLVED' ? 'success' : 'warning'}>
                    This alert is {alert.status.toLowerCase()} and cannot move again. History is retained.
                  </InlineAlert>
                  <Link
                    to="/overlaps"
                    className="inline-flex text-xs font-semibold text-primary-700 hover:underline"
                  >
                    Return to alert register
                  </Link>
                </>
              ) : canReview ? (
                <>
                  <p className="text-xs text-slate-600">
                    A decision is applied to every linked case, notified to the assigned officers and management, and
                    written to the audit trail.
                  </p>
                  <div className="flex flex-col gap-2">
                    <Button onClick={() => openReview('COORDINATION_REQUIRED')}>
                      <Network className="h-4 w-4" /> Require coordination
                    </Button>
                    <Button variant="outline" onClick={() => openReview('UNDER_REVIEW')}>
                      Mark under review
                    </Button>
                    <Button variant="success" onClick={() => openReview('RESOLVED')}>
                      <CheckCircle2 className="h-4 w-4" /> Resolve alert
                    </Button>
                    <Button variant="danger" onClick={() => openReview('DISMISSED')}>
                      Dismiss as false positive
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">
                  Read-only roles cannot change the alert state. Contact an authorised officer.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Why this alert exists" icon={<AlertTriangle className="h-4 w-4" />} />
            <div className="space-y-2 p-5 text-xs text-slate-600">
              <p>
                A cross-Bureau alert groups complaints about the same institution that are owned by different Bureaus.
                It is a coordination prompt, not a finding of duplication.
              </p>
              <p>
                A potential-duplicate alert identifies overlapping complaints within the same institution. Review the
                linked cases before deciding.
              </p>
              <p>Alert keys are stable, so repeated evaluation does not create duplicate alerts.</p>
            </div>
          </Card>

          <Card>
            <CardHeader title="At a glance" icon={<UserCheck className="h-4 w-4" />} />
            <div className="space-y-2 p-5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Linked cases</span>
                <span className="font-semibold text-slate-900">{alert.cases?.length ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Reviews</span>
                <span className="font-semibold text-slate-900">{alert.reviews?.length ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Age</span>
                <span className="font-semibold text-slate-900">{formatDate(alert.firstDetectedAt)}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={reviewOpen}
        onClose={() => (busy ? undefined : setReviewOpen(false))}
        title="Record alert review"
        description="The decision applies to every linked case and notifies the accountable officers."
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviewOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={form.status === 'DISMISSED' ? 'danger' : form.status === 'RESOLVED' ? 'success' : 'primary'}
              onClick={() => {
                const formElement = document.getElementById('alert-review-form') as HTMLFormElement | null;
                formElement?.requestSubmit();
              }}
              loading={busy}
            >
              Save decision
            </Button>
          </>
        }
      >
        <form id="alert-review-form" onSubmit={submit} className="space-y-4">
          {modalError && <InlineAlert tone="danger">{modalError}</InlineAlert>}
          <Field label="Decision" required>
            <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              {transitions.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status] ?? titleize(status)}
                </option>
              ))}
            </Select>
          </Field>

          {form.status === 'RESOLVED' && (
            <Field label="Resolution outcome" required hint="Summarise what was coordinated or confirmed.">
              <Textarea
                value={form.outcome}
                onChange={(event) => setForm({ ...form, outcome: event.target.value })}
                placeholder="e.g. Both Bureaus confirmed separate grievances from the same institution; coordination note shared."
              />
            </Field>
          )}

          {form.status === 'DISMISSED' && (
            <Field label="Dismissal reason" required hint="Explain why this is a false positive.">
              <Textarea
                value={form.dismissalReason}
                onChange={(event) => setForm({ ...form, dismissalReason: event.target.value })}
                placeholder="e.g. The complaints concern different departments and are not duplicates."
              />
            </Field>
          )}

          <Field label="Coordinator" hint="Optional. The coordinator is notified and recorded on the alert.">
            <Select
              value={form.assignedCoordinatorId}
              onChange={(event) => setForm({ ...form, assignedCoordinatorId: event.target.value })}
            >
              <option value="">No coordinator assigned</option>
              {(officers.data ?? []).map((officer) => (
                <option key={officer.id} value={officer.id}>
                  {officer.firstName} {officer.lastName}
                  {officer.bureau ? ` · ${officer.bureau.code}` : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Review remarks">
            <Textarea
              value={form.remarks}
              onChange={(event) => setForm({ ...form, remarks: event.target.value })}
              placeholder="Optional context for the case history and audit trail."
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
