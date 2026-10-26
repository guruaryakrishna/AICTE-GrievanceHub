import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  FileText,
  GitMerge,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Tag,
  Users,
} from 'lucide-react';
import api from '../services/api';
import { canManageInstitutions, useAuth } from '../contexts/AuthContext';
import { useAsyncData } from '../hooks/useAsyncData';
import { formatDate, formatDateTime, getErrorMessage, titleize } from '../lib/format';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  DescriptionList,
  EmptyState,
  ErrorBlock,
  Field,
  InlineAlert,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  SlaBadge,
  StatCard,
  StatusBadge,
  Textarea,
} from '../components/ui';
import type { AlertSummary, CaseRecord, Institution, Region } from '../services/types';

interface InstitutionDetailData extends Institution {
  cases: CaseRecord[];
  alerts: AlertSummary[];
  metrics: {
    totalCases: number;
    pendingCases: number;
    activeCases: number;
    disposedCases: number;
    overdueCases: number;
    approachingCases: number;
    casesByBureau: { bureau: string; code: string; count: number }[];
  };
}

interface EditForm {
  name: string;
  aictePermanentId: string;
  alternateNames: string;
  institutionType: string;
  address: string;
  city: string;
  district: string;
  state: string;
  regionId: string;
  pinCode: string;
  isActive: boolean;
}

function toEditForm(institution: InstitutionDetailData): EditForm {
  return {
    name: institution.name,
    aictePermanentId: institution.aictePermanentId,
    alternateNames: (institution.alternateNamesList ?? []).join(', '),
    institutionType: institution.institutionType ?? '',
    address: institution.address ?? '',
    city: institution.city ?? '',
    district: institution.district ?? '',
    state: institution.state ?? '',
    regionId: institution.regionId ?? '',
    pinCode: institution.pinCode ?? '',
    isActive: institution.isActive,
  };
}

export default function InstitutionDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const canManage = canManageInstitutions(user?.role);
  const isAdmin = user?.role === 'ADMIN';

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [aliasOpen, setAliasOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [aliasValue, setAliasValue] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [mergeReason, setMergeReason] = useState('');
  const [mergeConfirmed, setMergeConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [modalError, setModalError] = useState('');

  const detail = useAsyncData(async () => {
    const response = await api.get(`/institutions/${id}`);
    return response.data.institution as InstitutionDetailData;
  }, [id]);

  const regions = useAsyncData(async () => {
    const response = await api.get('/institutions/meta/regions');
    return (response.data.regions ?? []) as Region[];
  }, []);

  const mergeCandidates = useAsyncData(async () => {
    if (!isAdmin || !mergeOpen) return [] as Institution[];
    const response = await api.get('/institutions', {
      params: { pageSize: 200, isActive: true, sortBy: 'name' },
    });
    return ((response.data.items ?? []) as Institution[]).filter((item) => item.id !== id);
  }, [isAdmin, mergeOpen, id]);

  const institution = detail.data;

  const refreshAll = () => {
    detail.reload();
    window.dispatchEvent(new Event('aicte:refresh'));
  };

  const openEdit = () => {
    if (!institution) return;
    setEditForm(toEditForm(institution));
    setModalError('');
    setEditOpen(true);
  };

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editForm) return;
    setBusy('edit');
    setModalError('');
    try {
      await api.patch(`/institutions/${id}`, {
        name: editForm.name.trim(),
        aictePermanentId: editForm.aictePermanentId.trim(),
        alternateNames: editForm.alternateNames
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        institutionType: editForm.institutionType.trim() || null,
        address: editForm.address.trim() || null,
        city: editForm.city.trim() || null,
        district: editForm.district.trim() || null,
        state: editForm.state.trim() || null,
        regionId: editForm.regionId || null,
        pinCode: editForm.pinCode.trim() || null,
        isActive: editForm.isActive,
      });
      toast.success('Institution record updated.');
      setEditOpen(false);
      refreshAll();
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const addAlias = async (event: React.FormEvent) => {
    event.preventDefault();
    if (aliasValue.trim().length < 2) {
      setModalError('Enter an alias of at least 2 characters.');
      return;
    }
    setBusy('alias');
    setModalError('');
    try {
      await api.post(`/institutions/${id}/aliases`, { alias: aliasValue.trim() });
      toast.success('Alias added. Future matches remain explainable and require review.');
      setAliasOpen(false);
      setAliasValue('');
      refreshAll();
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const merge = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mergeTarget) {
      setModalError('Select the canonical institution to merge into.');
      return;
    }
    if (mergeReason.trim().length < 5) {
      setModalError('Provide a merge reason of at least 5 characters.');
      return;
    }
    if (!mergeConfirmed) {
      setModalError('Confirm that history should move to the canonical record.');
      return;
    }
    setBusy('merge');
    setModalError('');
    try {
      await api.post(`/institutions/${id}/merge`, {
        targetInstitutionId: mergeTarget,
        reason: mergeReason.trim(),
      });
      toast.success('Institution merged. Cases, alerts and history now point at the canonical record.');
      window.dispatchEvent(new Event('aicte:refresh'));
      navigate(`/institutions/${mergeTarget}`);
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (detail.error) {
    return (
      <Card>
        <ErrorBlock message={detail.error} onRetry={detail.reload} />
      </Card>
    );
  }

  if (detail.loading && !institution) {
    return (
      <Card>
        <LoadingBlock label="Loading institution 360…" />
      </Card>
    );
  }

  if (!institution) {
    return (
      <Card>
        <EmptyState
          title="Institution not found"
          message="The record may have been merged or is outside your authorised scope."
          action={
            <Button variant="outline" onClick={() => navigate('/institutions')}>
              Back to directory
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <Link to="/institutions" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-700 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to institution directory
        </Link>
      </div>

      <PageHeader
        eyebrow="Institution 360"
        title={institution.name}
        subtitle={`AICTE Permanent ID ${institution.aictePermanentId}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={detail.reload} loading={detail.loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            {canManage && (
              <>
                <Button variant="outline" size="sm" onClick={() => setAliasOpen(true)}>
                  <Plus className="h-4 w-4" /> Add alias
                </Button>
                <Button variant="secondary" size="sm" onClick={openEdit}>
                  <Pencil className="h-4 w-4" /> Edit record
                </Button>
              </>
            )}
            {isAdmin && (
              <Button variant="danger" size="sm" onClick={() => setMergeOpen(true)}>
                <GitMerge className="h-4 w-4" /> Merge duplicate
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={institution.isActive ? 'emerald' : 'slate'}>
          {institution.isActive ? 'Active record' : 'Inactive record'}
        </Badge>
        {institution.region && <Badge tone="blue">{institution.region.name}</Badge>}
        <Badge tone="teal">{institution.institutionType ?? 'Institution'}</Badge>
        <Badge tone="slate">{institution.aliases?.length ?? 0} alias(es)</Badge>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Total cases" value={institution.metrics.totalCases} icon={<FileText className="h-5 w-5" />} />
        <StatCard label="Open" value={institution.metrics.pendingCases} tone="info" icon={<Building2 className="h-5 w-5" />} />
        <StatCard label="Active process" value={institution.metrics.activeCases} tone="info" icon={<Users className="h-5 w-5" />} />
        <StatCard label="Disposed" value={institution.metrics.disposedCases} tone="success" icon={<FileText className="h-5 w-5" />} />
        <StatCard label="Overdue" value={institution.metrics.overdueCases} tone="danger" icon={<AlertTriangle className="h-5 w-5" />} />
        <StatCard label="Coordination alerts" value={institution.alerts.length} tone="warning" icon={<ShieldAlert className="h-5 w-5" />} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Institution identity" subtitle="Stable key and location record" icon={<Building2 className="h-4 w-4" />} />
            <div className="space-y-4 p-5">
              <DescriptionList
                columns={3}
                items={[
                  { label: 'AICTE Permanent ID', value: institution.aictePermanentId },
                  { label: 'Registered name', value: institution.name },
                  { label: 'Normalised name', value: institution.normalizedName },
                  { label: 'Type', value: institution.institutionType ?? '—' },
                  { label: 'Region', value: institution.region?.name ?? 'Not assigned' },
                  { label: 'PIN code', value: institution.pinCode ?? '—' },
                  { label: 'Address', value: institution.address ?? '—' },
                  { label: 'City', value: institution.city ?? '—' },
                  { label: 'District', value: institution.district ?? '—' },
                  { label: 'State', value: institution.state ?? '—' },
                  { label: 'Created', value: formatDateTime(institution.createdAt) },
                  { label: 'Last updated', value: formatDateTime(institution.updatedAt) },
                ]}
              />
              <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <p className="text-xs text-slate-600">
                  Institution-level counts include only cases already verified against this stable ID. Pending identity
                  queues are excluded until an authorised officer resolves them.
                </p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Complaint history"
              subtitle="Every case visible to your scope for this institution"
              icon={<FileText className="h-4 w-4" />}
              action={
                <Link
                  to={`/cases?q=${encodeURIComponent(institution.aictePermanentId)}`}
                  className="text-xs font-semibold text-primary-700 hover:underline"
                >
                  Open in case register
                </Link>
              }
            />
            {institution.cases.length === 0 ? (
              <EmptyState title="No cases linked" message="No complaint in your scope is linked to this record." />
            ) : (
              <div className="divide-y divide-slate-100">
                {institution.cases.map((item) => (
                  <Link
                    key={item.id}
                    to={`/cases/${item.id}`}
                    className="flex flex-col gap-2 px-5 py-3 transition hover:bg-slate-50 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-primary-700">{item.caseNumber}</span>
                        <StatusBadge status={item.status} />
                        <SlaBadge sla={item.sla} />
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-slate-900">{item.title}</p>
                      <p className="text-xs text-slate-500">
                        {item.category?.name ?? 'Uncategorised'} · {item.currentBureau?.name ?? 'No Bureau'} · Received{' '}
                        {formatDate(item.dateReceived)}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-primary-700">Open case →</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Coordination alerts"
              subtitle="Cross-Bureau overlaps and potential duplicates for this institution"
              icon={<ShieldAlert className="h-4 w-4" />}
              action={<Badge tone="slate">{institution.alerts.length}</Badge>}
            />
            {institution.alerts.length === 0 ? (
              <EmptyState title="No coordination alerts" message="No overlap or duplicate signal is recorded for this institution." />
            ) : (
              <div className="divide-y divide-slate-100">
                {institution.alerts.map((alert) => (
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
                        {alert.cases?.length ?? 0} case(s) · detected {formatDate(alert.firstDetectedAt)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-700">{alert.detectionReason}</p>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Aliases"
              subtitle="Explainable name variants only"
              icon={<Tag className="h-4 w-4" />}
              action={
                canManage ? (
                  <Button size="sm" variant="ghost" onClick={() => setAliasOpen(true)}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                ) : undefined
              }
            />
            <div className="space-y-3 p-5">
              {(institution.alternateNamesList ?? []).length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Registered alternates</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {(institution.alternateNamesList ?? []).map((name) => (
                      <Badge key={name} tone="blue">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Reviewable aliases</p>
                {(institution.aliases ?? []).length === 0 ? (
                  <p className="mt-1 text-sm text-slate-500">No alias is recorded.</p>
                ) : (
                  <ul className="mt-1 space-y-1.5">
                    {(institution.aliases ?? []).map((alias) => (
                      <li key={alias.id} className="rounded-md border border-slate-200 px-2.5 py-1.5">
                        <p className="text-sm text-slate-800">{alias.alias}</p>
                        <p className="text-[10px] text-slate-400">Normalised: {alias.normalizedAlias}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <InlineAlert tone="warning">
                Adding an alias never links cases automatically. It produces candidates that require officer review.
              </InlineAlert>
            </div>
          </Card>

          <Card>
            <CardHeader title="Workload by Bureau" subtitle="Visible cases only" icon={<Building2 className="h-4 w-4" />} />
            <div className="space-y-3 p-5">
              {institution.metrics.casesByBureau.length === 0 ? (
                <p className="text-sm text-slate-500">No Bureau ownership recorded.</p>
              ) : (
                institution.metrics.casesByBureau.map((row) => (
                  <div key={`${row.code}-${row.bureau}`} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">
                      {row.bureau} <span className="text-xs text-slate-400">({row.code})</span>
                    </span>
                    <span className="font-semibold text-slate-900">{row.count}</span>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Data integrity" icon={<ShieldAlert className="h-4 w-4" />} />
            <div className="space-y-2 p-5 text-xs text-slate-600">
              <p>Merging a duplicate transfers cases, alerts and identity resolutions, records the source as inactive and keeps history intact.</p>
              {canManage ? (
                <p>All edits and alias changes are written to the administrative audit trail.</p>
              ) : (
                <p>Your role can view this record but cannot change institution identity.</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={editOpen}
        onClose={() => (busy ? undefined : setEditOpen(false))}
        title="Edit institution record"
        description="Changing the AICTE Permanent ID changes identity. Existing cases remain linked to this record."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={busy === 'edit'}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const formElement = document.getElementById('edit-institution-form') as HTMLFormElement | null;
                formElement?.requestSubmit();
              }}
              loading={busy === 'edit'}
            >
              Save changes
            </Button>
          </>
        }
      >
        {editForm && (
          <form id="edit-institution-form" onSubmit={saveEdit} className="space-y-4">
            {modalError && <InlineAlert tone="danger">{modalError}</InlineAlert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required>
                <Input
                  value={editForm.name}
                  onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                />
              </Field>
              <Field label="AICTE Permanent ID" required>
                <Input
                  value={editForm.aictePermanentId}
                  onChange={(event) => setEditForm({ ...editForm, aictePermanentId: event.target.value })}
                />
              </Field>
              <Field label="Alternate names" hint="Comma-separated; also stored as reviewable aliases." className="sm:col-span-2">
                <Input
                  value={editForm.alternateNames}
                  onChange={(event) => setEditForm({ ...editForm, alternateNames: event.target.value })}
                />
              </Field>
              <Field label="Institution type">
                <Input
                  value={editForm.institutionType}
                  onChange={(event) => setEditForm({ ...editForm, institutionType: event.target.value })}
                />
              </Field>
              <Field label="Region">
                <Select
                  value={editForm.regionId}
                  onChange={(event) => setEditForm({ ...editForm, regionId: event.target.value })}
                  disabled={user?.role === 'REGIONAL_OFFICER'}
                >
                  <option value="">No region</option>
                  {(regions.data ?? []).map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Address" className="sm:col-span-2">
                <Input
                  value={editForm.address}
                  onChange={(event) => setEditForm({ ...editForm, address: event.target.value })}
                />
              </Field>
              <Field label="City">
                <Input
                  value={editForm.city}
                  onChange={(event) => setEditForm({ ...editForm, city: event.target.value })}
                />
              </Field>
              <Field label="District">
                <Input
                  value={editForm.district}
                  onChange={(event) => setEditForm({ ...editForm, district: event.target.value })}
                />
              </Field>
              <Field label="State">
                <Input
                  value={editForm.state}
                  onChange={(event) => setEditForm({ ...editForm, state: event.target.value })}
                />
              </Field>
              <Field label="PIN code">
                <Input
                  value={editForm.pinCode}
                  onChange={(event) => setEditForm({ ...editForm, pinCode: event.target.value })}
                  maxLength={6}
                  inputMode="numeric"
                />
              </Field>
            </div>
            <Checkbox
              label="Record is active and available for new complaints."
              checked={editForm.isActive}
              onChange={(event) => setEditForm({ ...editForm, isActive: event.target.checked })}
            />
          </form>
        )}
      </Modal>

      <Modal
        open={aliasOpen}
        onClose={() => (busy === 'alias' ? undefined : setAliasOpen(false))}
        title="Add institution alias"
        description="An alias is a name variant that may produce a candidate. It is never proof of identity."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAliasOpen(false)} disabled={busy === 'alias'}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const formElement = document.getElementById('alias-form') as HTMLFormElement | null;
                formElement?.requestSubmit();
              }}
              loading={busy === 'alias'}
            >
              Add alias
            </Button>
          </>
        }
      >
        <form id="alias-form" onSubmit={addAlias} className="space-y-4">
          {modalError && <InlineAlert tone="danger">{modalError}</InlineAlert>}
          <Field label="Alias" required hint="At least 2 characters. Conflicting aliases are rejected.">
            <Input
              value={aliasValue}
              onChange={(event) => setAliasValue(event.target.value)}
              placeholder="e.g. ABC Engineering Institute"
            />
          </Field>
          <InlineAlert tone="warning">
            If this alias already identifies another institution, the request is rejected. Review or merge the records
            instead.
          </InlineAlert>
        </form>
      </Modal>

      <Modal
        open={mergeOpen}
        onClose={() => (busy === 'merge' ? undefined : setMergeOpen(false))}
        title="Merge this duplicate into a canonical record"
        description="The source record becomes inactive. Cases, alerts, aliases and identity resolutions move to the target; nothing is deleted."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMergeOpen(false)} disabled={busy === 'merge'}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const formElement = document.getElementById('merge-form') as HTMLFormElement | null;
                formElement?.requestSubmit();
              }}
              loading={busy === 'merge'}
              disabled={!mergeConfirmed}
            >
              Merge records
            </Button>
          </>
        }
      >
        <form id="merge-form" onSubmit={merge} className="space-y-4">
          {modalError && <InlineAlert tone="danger">{modalError}</InlineAlert>}
          <InlineAlert tone="warning" title="Irreversible merge">
            This is an administrative operation. Review both records and confirm the canonical target.
          </InlineAlert>
          <Field label="Canonical target institution" required>
            <Select
              value={mergeTarget}
              onChange={(event) => setMergeTarget(event.target.value)}
              disabled={mergeCandidates.loading}
            >
              <option value="">Select target record</option>
              {(mergeCandidates.data ?? []).map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} · {candidate.aictePermanentId}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Merge reason" required>
            <Textarea
              value={mergeReason}
              onChange={(event) => setMergeReason(event.target.value)}
              placeholder="Why are these records the same institution?"
            />
          </Field>
          <Checkbox
            label={`I confirm that ${institution.name} (${institution.aictePermanentId}) is a duplicate of the selected target.`}
            checked={mergeConfirmed}
            onChange={(event) => setMergeConfirmed(event.target.checked)}
          />
        </form>
      </Modal>
    </div>
  );
}
