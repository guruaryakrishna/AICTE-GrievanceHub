import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  Fingerprint,
  History,
  Link2,
  RefreshCw,
  ShieldAlert,
  Timer,
  User,
  UserCheck,
  Workflow,
} from 'lucide-react';
import api from '../services/api';
import { useAsyncData } from '../hooks/useAsyncData';
import { formatDate, formatDateInput, formatDateTime, getErrorMessage, titleize } from '../lib/format';
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
  Modal,
  PageHeader,
  PriorityBadge,
  Select,
  SlaBadge,
  StatusBadge,
  Textarea,
} from '../components/ui';
import type { Bureau, CaseRecord, OfficerRef } from '../services/types';

type ModalKind = 'status' | 'assign' | 'action' | 'transfer' | 'escalate' | 'dispose' | 'reopen';

const ACTION_TONES: Record<string, string> = {
  CREATED: 'bg-slate-100 text-slate-600',
  STATUS_CHANGED: 'bg-sky-100 text-sky-700',
  ASSIGNED: 'bg-indigo-100 text-indigo-700',
  REASSIGNED: 'bg-indigo-100 text-indigo-700',
  REMARK: 'bg-slate-100 text-slate-600',
  TRANSFERRED: 'bg-violet-100 text-violet-700',
  ESCALATED: 'bg-red-100 text-red-700',
  DISPOSED: 'bg-emerald-100 text-emerald-700',
  REOPENED: 'bg-amber-100 text-amber-700',
  IDENTITY_RESOLVED: 'bg-accent-100 text-accent-800',
  IDENTITY_DISMISSED: 'bg-slate-100 text-slate-600',
};

export default function CaseDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState('');
  const [transferOfficers, setTransferOfficers] = useState<OfficerRef[]>([]);

  const [statusForm, setStatusForm] = useState({ status: '', remarks: '' });
  const [assignForm, setAssignForm] = useState({ assignedOfficerId: '', remarks: '' });
  const [actionForm, setActionForm] = useState({
    remarks: '',
    nextRequiredAction: '',
    nextActionDueDate: '',
  });
  const [transferForm, setTransferForm] = useState({ toBureauId: '', toOfficerId: '', reason: '' });
  const [escalateForm, setEscalateForm] = useState({ reason: '', escalateTo: '' });
  const [disposeForm, setDisposeForm] = useState({ resolutionRemarks: '' });
  const [reopenForm, setReopenForm] = useState({ reason: '' });

  const detail = useAsyncData(async () => {
    const response = await api.get(`/cases/${id}`);
    return response.data.case as CaseRecord;
  }, [id]);

  const bureaus = useAsyncData(async () => {
    const response = await api.get('/institutions/meta/bureaus');
    return (response.data.bureaus ?? []) as Bureau[];
  }, []);

  const officers = useAsyncData(async () => {
    if (!detail.data) return [] as OfficerRef[];
    const params = detail.data.currentBureauId ? { bureauId: detail.data.currentBureauId } : {};
    const response = await api.get('/cases/meta/officers', { params });
    return (response.data.officers ?? []) as OfficerRef[];
  }, [detail.data?.currentBureauId]);

  const record = detail.data;

  const refreshBadges = () => window.dispatchEvent(new Event('aicte:refresh'));

  const closeModal = () => {
    setModal(null);
    setModalError('');
  };

  const run = async (request: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setModalError('');
    try {
      await request();
      toast.success(successMessage);
      closeModal();
      detail.reload();
      refreshBadges();
    } catch (error) {
      setModalError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const openStatus = () => {
    setStatusForm({ status: record?.allowedStatusTargets[0] ?? '', remarks: '' });
    setModalError('');
    setModal('status');
  };

  const openAssign = () => {
    setAssignForm({ assignedOfficerId: record?.assignedOfficerId ?? '', remarks: '' });
    setModalError('');
    setModal('assign');
  };

  const openAction = () => {
    setActionForm({
      remarks: '',
      nextRequiredAction: record?.nextRequiredAction ?? '',
      nextActionDueDate: formatDateInput(record?.nextActionDueDate),
    });
    setModalError('');
    setModal('action');
  };

  const openTransfer = () => {
    setTransferForm({ toBureauId: '', toOfficerId: '', reason: '' });
    setTransferOfficers([]);
    setModalError('');
    setModal('transfer');
  };

  const loadTransferOfficers = async (bureauId: string) => {
    setTransferForm((current) => ({ ...current, toBureauId: bureauId, toOfficerId: '' }));
    if (!bureauId) {
      setTransferOfficers([]);
      return;
    }
    try {
      const response = await api.get('/cases/meta/officers', { params: { bureauId } });
      setTransferOfficers((response.data.officers ?? []) as OfficerRef[]);
    } catch {
      setTransferOfficers([]);
    }
  };

  const submitStatus = () => {
    if (!statusForm.status) {
      setModalError('Select the next lifecycle state.');
      return;
    }
    void run(
      () =>
        api.post(`/cases/${id}/status`, {
          status: statusForm.status,
          remarks: statusForm.remarks.trim() || undefined,
        }),
      'Case status updated.',
    );
  };

  const submitAssign = () =>
    void run(
      () =>
        api.post(`/cases/${id}/assign`, {
          assignedOfficerId: assignForm.assignedOfficerId || null,
          remarks: assignForm.remarks.trim() || undefined,
        }),
      assignForm.assignedOfficerId ? 'Case assignment updated.' : 'Case unassigned.',
    );

  const submitAction = () => {
    if (actionForm.remarks.trim().length < 2) {
      setModalError('Enter a remark of at least 2 characters.');
      return;
    }
    void run(
      () =>
        api.post(`/cases/${id}/actions`, {
          remarks: actionForm.remarks.trim(),
          nextRequiredAction: actionForm.nextRequiredAction.trim() || null,
          nextActionDueDate: actionForm.nextActionDueDate
            ? new Date(`${actionForm.nextActionDueDate}T00:00:00`).toISOString()
            : null,
        }),
      'Case action recorded.',
    );
  };

  const submitTransfer = () => {
    if (!transferForm.toBureauId) {
      setModalError('Select the destination Bureau / Cell.');
      return;
    }
    if (transferForm.reason.trim().length < 5) {
      setModalError('Provide a transfer reason of at least 5 characters.');
      return;
    }
    void run(
      () =>
        api.post(`/cases/${id}/transfer`, {
          toBureauId: transferForm.toBureauId,
          toOfficerId: transferForm.toOfficerId || null,
          reason: transferForm.reason.trim(),
        }),
      'Case transferred. The destination Bureau owns the next action.',
    );
  };

  const submitEscalate = () => {
    if (escalateForm.reason.trim().length < 5) {
      setModalError('Provide an escalation reason of at least 5 characters.');
      return;
    }
    void run(
      () =>
        api.post(`/cases/${id}/escalate`, {
          reason: escalateForm.reason.trim(),
          escalateTo: escalateForm.escalateTo.trim() || null,
        }),
      'Case escalated to management.',
    );
  };

  const submitDispose = () => {
    if (disposeForm.resolutionRemarks.trim().length < 10) {
      setModalError('Resolution remarks must be meaningful (at least 10 characters).');
      return;
    }
    void run(
      () =>
        api.post(`/cases/${id}/dispose`, {
          resolutionRemarks: disposeForm.resolutionRemarks.trim(),
        }),
      'Case disposed with a recorded resolution.',
    );
  };

  const submitReopen = () => {
    if (reopenForm.reason.trim().length < 10) {
      setModalError('Provide a meaningful reopen reason (at least 10 characters).');
      return;
    }
    void run(
      () => api.post(`/cases/${id}/reopen`, { reason: reopenForm.reason.trim() }),
      'Case reopened and a new SLA clock started.',
    );
  };

  const assignableOfficers = (officers.data ?? []).filter((officer) =>
    record?.currentBureauId ? true : officer.role === 'ADMIN',
  );

  if (detail.error) {
    return (
      <Card>
        <ErrorBlock message={detail.error} onRetry={detail.reload} />
      </Card>
    );
  }

  if (detail.loading && !record) {
    return (
      <Card>
        <LoadingBlock label="Loading case…" />
      </Card>
    );
  }

  if (!record) {
    return (
      <Card>
        <EmptyState
          title="Case not found"
          message="The case may have been removed or is outside your authorised scope."
          action={
            <Button variant="outline" onClick={() => navigate('/cases')}>
              Back to cases
            </Button>
          }
        />
      </Card>
    );
  }

  const permissions = record.permissions ?? {
    canModify: false,
    canAssign: false,
    canAddAction: false,
    canTransfer: false,
    canEscalate: false,
    canDispose: false,
    canReopen: false,
  };
  const blockedBySla = record.sla?.state === 'OVERDUE';

  return (
    <div>
      <div className="mb-4">
        <Link to="/cases" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-700 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to case register
        </Link>
      </div>

      <PageHeader
        eyebrow="Case file"
        title={record.caseNumber}
        subtitle={record.title}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={detail.reload} loading={detail.loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            {permissions.canAssign && (
              <Button variant="outline" size="sm" onClick={openAssign}>
                <UserCheck className="h-4 w-4" /> Assign
              </Button>
            )}
            {permissions.canAddAction && (
              <Button variant="outline" size="sm" onClick={openAction}>
                <FileText className="h-4 w-4" /> Add action
              </Button>
            )}
            {permissions.canModify && record.allowedStatusTargets.length > 0 && (
              <Button variant="secondary" size="sm" onClick={openStatus}>
                <Workflow className="h-4 w-4" /> Change status
              </Button>
            )}
            {permissions.canTransfer && (
              <Button variant="outline" size="sm" onClick={openTransfer}>
                <Link2 className="h-4 w-4" /> Transfer
              </Button>
            )}
            {permissions.canEscalate && (
              <Button variant="outline" size="sm" onClick={() => setModal('escalate')}>
                <ShieldAlert className="h-4 w-4" /> Escalate
              </Button>
            )}
            {permissions.canDispose && (
              <Button variant="success" size="sm" onClick={() => setModal('dispose')}>
                <CheckCircle2 className="h-4 w-4" /> Dispose
              </Button>
            )}
            {permissions.canReopen && (
              <Button variant="primary" size="sm" onClick={() => setModal('reopen')}>
                <RefreshCw className="h-4 w-4" /> Reopen
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={record.status} />
        <PriorityBadge priority={record.priority} />
        <SlaBadge sla={record.sla} />
        {blockedBySla && (
          <Badge tone="red">
            <AlertTriangle className="h-3 w-3" /> SLA breach
          </Badge>
        )}
        {record.identityResolution?.status === 'PENDING' && (
          <Badge tone="amber">
            <Fingerprint className="h-3 w-3" /> Institution identity pending
          </Badge>
        )}
        {!permissions.canModify && <Badge tone="slate">Read-only for your role</Badge>}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Complaint details" icon={<FileText className="h-4 w-4" />} />
            <div className="space-y-4 p-5">
              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{record.description}</p>
              <DescriptionList
                columns={3}
                items={[
                  { label: 'Category', value: record.category?.name ?? '—' },
                  { label: 'Date received', value: formatDate(record.dateReceived) },
                  { label: 'Last action', value: record.lastAction ?? '—' },
                  { label: 'Next required action', value: record.nextRequiredAction ?? '—' },
                  {
                    label: 'Next action due',
                    value: record.nextActionDueDate ? formatDateTime(record.nextActionDueDate) : '—',
                  },
                  {
                    label: 'Expected disposal',
                    value: record.expectedDisposalDate ? formatDate(record.expectedDisposalDate) : '—',
                  },
                ]}
              />
              {record.resolutionRemarks && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Resolution</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-emerald-900">{record.resolutionRemarks}</p>
                  {record.disposedAt && (
                    <p className="mt-1 text-xs text-emerald-700">Disposed {formatDateTime(record.disposedAt)}</p>
                  )}
                </div>
              )}
              {record.reopenReason && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Reopen reason</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">{record.reopenReason}</p>
                </div>
              )}
            </div>
          </Card>

          {record.identityResolution && (
            <Card className="border-amber-200">
              <CardHeader
                title="Institution identity resolution"
                subtitle="Names and aliases never auto-link; an authorised officer must confirm the stable AICTE ID."
                icon={<Fingerprint className="h-4 w-4" />}
                action={<StatusBadge status={record.identityResolution.status} />}
              />
              <div className="space-y-3 p-5">
                <DescriptionList
                  items={[
                    { label: 'Submitted name', value: record.identityResolution.submittedName },
                    {
                      label: 'Submitted AICTE ID',
                      value: record.identityResolution.submittedAictePermanentId ?? 'Not supplied',
                    },
                    {
                      label: 'Candidates suggested',
                      value: String(record.identityResolution.candidateEvidence?.candidates?.length ?? 0),
                    },
                    {
                      label: 'Resolved institution',
                      value: record.identityResolution.resolvedInstitution
                        ? `${record.identityResolution.resolvedInstitution.name} (${record.identityResolution.resolvedInstitution.aictePermanentId})`
                        : '—',
                    },
                  ]}
                />
                {record.identityResolution.status === 'PENDING' && (
                  <InlineAlert tone="warning">
                    Institution-level counts exclude this case until the identity is verified.{' '}
                    <Link to="/identity" className="font-semibold underline">
                      Open the identity queue
                    </Link>
                    .
                  </InlineAlert>
                )}
                {record.identityResolution.resolutionNote && (
                  <p className="text-xs text-slate-600">Note: {record.identityResolution.resolutionNote}</p>
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Action history"
              subtitle="Immutable, server-written audit of every lifecycle event"
              icon={<History className="h-4 w-4" />}
              action={<Badge tone="slate">{record.actionHistory?.length ?? 0} events</Badge>}
            />
            {!record.actionHistory || record.actionHistory.length === 0 ? (
              <EmptyState title="No actions recorded" />
            ) : (
              <ol className="divide-y divide-slate-100">
                {record.actionHistory.map((action) => (
                  <li key={action.id} className="flex gap-3 px-5 py-4">
                    <div
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        ACTION_TONES[action.actionType] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <Clock className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{titleize(action.actionType)}</p>
                        <p className="text-[11px] text-slate-500">{formatDateTime(action.timestamp)}</p>
                      </div>
                      <p className="text-xs text-slate-500">
                        {action.performedBy
                          ? `${action.performedBy.firstName} ${action.performedBy.lastName}`
                          : 'System'}
                      </p>
                      {action.remarks && (
                        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{action.remarks}</p>
                      )}
                      {(action.previousValue || action.newValue) && (
                        <p className="mt-1 text-xs text-slate-500">
                          {action.previousValue ?? '—'} <span className="mx-1">→</span> {action.newValue ?? '—'}
                        </p>
                      )}
                      {action.metadata != null && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[11px] font-medium text-slate-400 hover:text-slate-600">
                            Event metadata
                          </summary>
                          <pre className="mt-1 overflow-x-auto rounded-md bg-slate-50 p-2 text-[10px] leading-4 text-slate-600">
                            {JSON.stringify(action.metadata, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Institution" icon={<Building2 className="h-4 w-4" />} />
            <div className="space-y-3 p-5">
              <p className="text-sm font-semibold text-slate-900">
                {record.institution?.name ?? record.originalInstitutionName ?? 'Unverified institution'}
              </p>
              {record.institution ? (
                <>
                  <p className="text-xs text-slate-500">AICTE Permanent ID · {record.institution.aictePermanentId}</p>
                  <p className="text-xs text-slate-500">
                    {[record.institution.city, record.institution.state].filter(Boolean).join(', ') || 'Location not recorded'}
                  </p>
                  <Link
                    to={`/institutions/${record.institution.id}`}
                    className="inline-flex text-xs font-semibold text-primary-700 hover:underline"
                  >
                    View institution 360 →
                  </Link>
                </>
              ) : (
                <InlineAlert tone="warning">
                  This complaint is linked to an unverified name. Open the identity queue to confirm the institution.
                </InlineAlert>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Ownership" icon={<User className="h-4 w-4" />} />
            <div className="p-5">
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Bureau / Cell', value: record.currentBureau?.name ?? 'Unassigned' },
                  {
                    label: 'Assigned officer',
                    value: record.assignedOfficer
                      ? `${record.assignedOfficer.firstName} ${record.assignedOfficer.lastName}`
                      : 'Unassigned',
                  },
                  {
                    label: 'Registered by',
                    value: record.createdBy
                      ? `${record.createdBy.firstName} ${record.createdBy.lastName}`
                      : '—',
                  },
                  { label: 'Registered on', value: formatDateTime(record.createdAt) },
                ]}
              />
            </div>
          </Card>

          <Card className={blockedBySla ? 'border-red-200' : undefined}>
            <CardHeader title="SLA clock" icon={<Timer className="h-4 w-4" />} />
            <div className="space-y-3 p-5">
              <div className="flex items-center justify-between">
                <SlaBadge sla={record.sla} />
                <span className="text-xs text-slate-500">{record.sla?.ruleName ?? 'No matching rule'}</span>
              </div>
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Deadline', value: record.sla?.dueAt ? formatDateTime(record.sla.dueAt) : '—' },
                  {
                    label: 'Remaining',
                    value:
                      record.sla?.hoursRemaining === null || record.sla?.hoursRemaining === undefined
                        ? '—'
                        : `${record.sla.hoursRemaining} hours`,
                  },
                  {
                    label: 'Warning window',
                    value: record.sla ? `${record.sla.warningThresholdHours} hours before deadline` : '—',
                  },
                ]}
              />
              {blockedBySla && (
                <InlineAlert tone="danger">
                  This case is past its shared SLA deadline. Record the next action or escalate with a reason.
                </InlineAlert>
              )}
              {record.status === 'DISPOSED' && (
                <InlineAlert tone="success">Disposed cases are never counted as overdue.</InlineAlert>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Linked coordination alerts"
              icon={<Link2 className="h-4 w-4" />}
              action={<Badge tone="slate">{record.alerts?.length ?? 0}</Badge>}
            />
            {!record.alerts || record.alerts.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">No overlap or duplicate alert is linked to this case.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {record.alerts.map((link) => {
                  const alert = link.alert;
                  if (!alert) return null;
                  return (
                    <li key={link.id} className="p-4">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={alert.status} />
                        <Badge tone={alert.alertType === 'POTENTIAL_DUPLICATE' ? 'amber' : 'teal'}>
                          {titleize(alert.alertType)}
                        </Badge>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs text-slate-600">{alert.detectionReason}</p>
                      <Link
                        to={`/overlaps/${alert.id}`}
                        className="mt-2 inline-flex text-xs font-semibold text-primary-700 hover:underline"
                      >
                        Review alert →
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={modal === 'status'}
        onClose={closeModal}
        title="Change lifecycle status"
        description="Only ordinary review progression is allowed here. Transfer, escalation, disposal and reopening use their own workflows."
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitStatus} loading={busy}>
              Update status
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && <InlineAlert tone="danger">{modalError}</InlineAlert>}
          <Field label="Next status" required>
            <Select
              value={statusForm.status}
              onChange={(event) => setStatusForm({ ...statusForm, status: event.target.value })}
            >
              {record.allowedStatusTargets.map((target) => (
                <option key={target} value={target}>
                  {titleize(target)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Remarks" hint="Optional context recorded in the case history.">
            <Textarea
              value={statusForm.remarks}
              onChange={(event) => setStatusForm({ ...statusForm, remarks: event.target.value })}
              placeholder="Why is the status changing?"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={modal === 'assign'}
        onClose={closeModal}
        title="Assign case owner"
        description="The assignee receives a deduplicated notification. Bureau officers must match the case Bureau."
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitAssign} loading={busy}>
              Save assignment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && <InlineAlert tone="danger">{modalError}</InlineAlert>}
          <Field
            label="Assigned officer"
            hint={
              record.currentBureauId
                ? `Officers in ${record.currentBureau?.name ?? 'this Bureau'} and administrators`
                : 'Select a Bureau first to assign a Bureau officer'
            }
          >
            <Select
              value={assignForm.assignedOfficerId}
              onChange={(event) => setAssignForm({ ...assignForm, assignedOfficerId: event.target.value })}
            >
              <option value="">Unassigned</option>
              {assignableOfficers.map((officer) => (
                <option key={officer.id} value={officer.id}>
                  {officer.firstName} {officer.lastName}
                  {officer.bureau ? ` · ${officer.bureau.code}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Remarks">
            <Textarea
              value={assignForm.remarks}
              onChange={(event) => setAssignForm({ ...assignForm, remarks: event.target.value })}
              placeholder="Optional assignment note"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={modal === 'action'}
        onClose={closeModal}
        title="Record a case action"
        description="Notes, next required action and the operational due date are written to the immutable action history."
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitAction} loading={busy}>
              Save action
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && <InlineAlert tone="danger">{modalError}</InlineAlert>}
          <Field label="Action remark" required>
            <Textarea
              value={actionForm.remarks}
              onChange={(event) => setActionForm({ ...actionForm, remarks: event.target.value })}
              placeholder="What was done and what happens next?"
            />
          </Field>
          <Field label="Next required action">
            <Input
              value={actionForm.nextRequiredAction}
              onChange={(event) => setActionForm({ ...actionForm, nextRequiredAction: event.target.value })}
              placeholder="e.g. Review inspection report"
            />
          </Field>
          <Field label="Next action due" hint="Operational due date. The SLA deadline continues to come from the shared policy.">
            <Input
              type="date"
              value={actionForm.nextActionDueDate}
              onChange={(event) => setActionForm({ ...actionForm, nextActionDueDate: event.target.value })}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={modal === 'transfer'}
        onClose={closeModal}
        title="Transfer to another Bureau / Cell"
        description="The destination Bureau becomes accountable. A reason is mandatory and the SLA clock continues."
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitTransfer} loading={busy}>
              Transfer case
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && <InlineAlert tone="danger">{modalError}</InlineAlert>}
          <Field label="Destination Bureau / Cell" required>
            <Select value={transferForm.toBureauId} onChange={(event) => void loadTransferOfficers(event.target.value)}>
              <option value="">Select destination</option>
              {(bureaus.data ?? [])
                .filter((bureau) => bureau.id !== record.currentBureauId)
                .map((bureau) => (
                  <option key={bureau.id} value={bureau.id}>
                    {bureau.code} · {bureau.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Destination officer" hint="Optional. Only officers in the destination Bureau are shown.">
            <Select
              value={transferForm.toOfficerId}
              onChange={(event) => setTransferForm({ ...transferForm, toOfficerId: event.target.value })}
              disabled={!transferForm.toBureauId}
            >
              <option value="">Leave unassigned</option>
              {transferOfficers.map((officer) => (
                <option key={officer.id} value={officer.id}>
                  {officer.firstName} {officer.lastName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Transfer reason" required>
            <Textarea
              value={transferForm.reason}
              onChange={(event) => setTransferForm({ ...transferForm, reason: event.target.value })}
              placeholder="Why does another Bureau need to own this case?"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={modal === 'escalate'}
        onClose={closeModal}
        title="Escalate case"
        description="Escalation raises the priority and notifies management. The case SLA remains governed by the shared policy."
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={submitEscalate} loading={busy}>
              Escalate
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && <InlineAlert tone="danger">{modalError}</InlineAlert>}
          <Field label="Escalation reason" required>
            <Textarea
              value={escalateForm.reason}
              onChange={(event) => setEscalateForm({ ...escalateForm, reason: event.target.value })}
              placeholder="Why is management attention required?"
            />
          </Field>
          <Field label="Escalate to" hint="Optional named authority or committee.">
            <Input
              value={escalateForm.escalateTo}
              onChange={(event) => setEscalateForm({ ...escalateForm, escalateTo: event.target.value })}
              placeholder="e.g. Senior Management Committee"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={modal === 'dispose'}
        onClose={closeModal}
        title="Dispose case"
        description="Disposal closes the case and stops the SLA clock. A meaningful resolution is mandatory."
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={busy}>
              Cancel
            </Button>
            <Button variant="success" onClick={submitDispose} loading={busy}>
              Confirm disposal
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && <InlineAlert tone="danger">{modalError}</InlineAlert>}
          <Field label="Resolution remarks" required hint="At least 10 characters. This is visible on the case and in exports.">
            <Textarea
              className="min-h-32"
              value={disposeForm.resolutionRemarks}
              onChange={(event) => setDisposeForm({ resolutionRemarks: event.target.value })}
              placeholder="Summarise the finding, action taken and why the matter is closed."
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={modal === 'reopen'}
        onClose={closeModal}
        title="Reopen disposed case"
        description="Reopening clears the resolution, restarts the SLA clock and notifies the original recipients."
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitReopen} loading={busy}>
              Reopen case
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && <InlineAlert tone="danger">{modalError}</InlineAlert>}
          <Field label="Reopen reason" required hint="At least 10 characters.">
            <Textarea
              value={reopenForm.reason}
              onChange={(event) => setReopenForm({ reason: event.target.value })}
              placeholder="Why does this matter need to be reopened?"
            />
          </Field>
          <InlineAlert tone="warning">
            Previous resolution: {record.resolutionRemarks ?? 'Not recorded'}
          </InlineAlert>
        </div>
      </Modal>

      <div className="mt-6 flex items-center gap-2 text-[11px] text-slate-400">
        <Clock className="h-3 w-3" />
        <CalendarClock className="h-3 w-3" />
        All timestamps are server-generated. The frontend never computes an authoritative deadline.
      </div>
    </div>
  );
}
