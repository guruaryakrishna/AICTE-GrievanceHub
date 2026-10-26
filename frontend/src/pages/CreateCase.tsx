import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  FilePlus2,
  Fingerprint,
  Search,
  ShieldQuestion,
  UserCheck,
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useAsyncData, useDebouncedValue } from '../hooks/useAsyncData';
import { getErrorMessage, titleize } from '../lib/format';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Textarea,
  cn,
} from '../components/ui';
import type {
  Bureau,
  Category,
  Institution,
  InstitutionCandidate,
  OfficerRef,
} from '../services/types';

type IdentityMode = 'verified' | 'unverified';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export default function CreateCase() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const [mode, setMode] = useState<IdentityMode>('verified');
  const [form, setForm] = useState({
    institutionId: '',
    institutionAictePermanentId: '',
    originalInstitutionName: '',
    identityReviewNote: '',
    title: '',
    description: '',
    categoryId: '',
    priority: 'MEDIUM',
    currentBureauId: '',
    assignedOfficerId: '',
    nextRequiredAction: '',
    nextActionDueDate: '',
    expectedDisposalDate: '',
  });
  const [institutionSearch, setInstitutionSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmedCandidate, setConfirmedCandidate] = useState(false);

  const debouncedName = useDebouncedValue(form.originalInstitutionName, 400);
  const debouncedAicteId = useDebouncedValue(form.institutionAictePermanentId, 400);
  const debouncedSearch = useDebouncedValue(institutionSearch, 300);

  const meta = useAsyncData(async () => {
    const [categories, bureaus, institutions] = await Promise.all([
      api.get('/institutions/meta/categories'),
      api.get('/institutions/meta/bureaus'),
      api.get('/institutions', { params: { pageSize: 200, isActive: true, sortBy: 'name' } }),
    ]);
    return {
      categories: (categories.data.categories ?? []) as Category[],
      bureaus: (bureaus.data.bureaus ?? []) as Bureau[],
      institutions: (institutions.data.items ?? []) as Institution[],
    };
  }, []);

  const directory = useAsyncData(async () => {
    const response = await api.get('/institutions', {
      params: { pageSize: 30, isActive: true, q: debouncedSearch || undefined, sortBy: 'name' },
    });
    return (response.data.items ?? []) as Institution[];
  }, [debouncedSearch]);

  const preview = useAsyncData<InstitutionCandidate[] | null>(async () => {
    if (mode !== 'unverified') return null;
    if (debouncedName.trim().length < 3 && debouncedAicteId.trim().length < 2) return null;
    const response = await api.get('/institutions/match', {
      params: {
        name: debouncedName.trim() || undefined,
        aictePermanentId: debouncedAicteId.trim() || undefined,
      },
    });
    return (response.data.candidates ?? []) as InstitutionCandidate[];
  }, [mode, debouncedName, debouncedAicteId]);

  const officers = useAsyncData(async () => {
    if (!form.currentBureauId) return [] as OfficerRef[];
    const response = await api.get('/cases/meta/officers', { params: { bureauId: form.currentBureauId } });
    return (response.data.officers ?? []) as OfficerRef[];
  }, [form.currentBureauId]);

  const selectedInstitution = (meta.data?.institutions ?? []).find((item) => item.id === form.institutionId) ?? null;
  const isBureauOfficer = user?.role === 'BUREAU_OFFICER';

  const switchMode = (next: IdentityMode) => {
    setMode(next);
    setError('');
    setConfirmedCandidate(false);
    if (next === 'verified') {
      setForm((current) => ({
        ...current,
        originalInstitutionName: '',
        institutionAictePermanentId: '',
        identityReviewNote: '',
      }));
    } else {
      setForm((current) => ({ ...current, institutionId: '' }));
    }
  };

  const chooseCandidate = (candidate: InstitutionCandidate) => {
    setMode('verified');
    setInstitutionSearch(candidate.institution.name);
    setForm((current) => ({
      ...current,
      institutionId: candidate.institution.id,
      originalInstitutionName: '',
      institutionAictePermanentId: '',
      identityReviewNote: '',
    }));
    setConfirmedCandidate(false);
    toast.info(
      `Selected ${candidate.institution.name}. Review the AICTE ID before submitting.`,
    );
  };

  const validate = (): string | null => {
    if (mode === 'verified' && !form.institutionId) {
      return 'Select a verified institution, or switch to unverified intake.';
    }
    if (mode === 'unverified' && form.originalInstitutionName.trim().length < 2) {
      return 'Enter the institution name exactly as supplied during intake.';
    }
    if (form.title.trim().length < 5) return 'The complaint title must be at least 5 characters.';
    if (form.description.trim().length < 20) {
      return 'Describe the complaint in at least 20 characters so an officer can act on it.';
    }
    if (!form.categoryId) return 'Select a complaint category.';
    if (
      mode === 'unverified' &&
      (preview.data?.length ?? 0) > 0 &&
      !confirmedCandidate
    ) {
      return 'Candidate institutions were found. Confirm that this is a genuinely unverified institution or select the matching record.';
    }
    return null;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim(),
        categoryId: form.categoryId,
        priority: form.priority,
      };
      if (mode === 'verified') {
        payload.institutionId = form.institutionId;
      } else {
        payload.originalInstitutionName = form.originalInstitutionName.trim();
        if (form.institutionAictePermanentId.trim()) {
          payload.institutionAictePermanentId = form.institutionAictePermanentId.trim();
        }
        if (form.identityReviewNote.trim()) payload.identityReviewNote = form.identityReviewNote.trim();
      }
      if (!isBureauOfficer && form.currentBureauId) payload.currentBureauId = form.currentBureauId;
      if (form.assignedOfficerId) payload.assignedOfficerId = form.assignedOfficerId;
      if (form.nextRequiredAction.trim()) payload.nextRequiredAction = form.nextRequiredAction.trim();
      if (form.nextActionDueDate) {
        payload.nextActionDueDate = new Date(`${form.nextActionDueDate}T00:00:00`).toISOString();
      }
      if (form.expectedDisposalDate) {
        payload.expectedDisposalDate = new Date(`${form.expectedDisposalDate}T00:00:00`).toISOString();
      }

      const response = await api.post('/cases', payload);
      toast.success('Complaint registered. The case register now shows its lifecycle state.');
      window.dispatchEvent(new Event('aicte:refresh'));
      navigate(`/cases/${response.data.case.id}`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const suggestedCandidates = preview.data ?? [];

  return (
    <div>
      <div className="mb-4">
        <Link to="/cases" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-700 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to case register
        </Link>
      </div>

      <PageHeader
        eyebrow="Complaint intake"
        title="Register a complaint"
        subtitle="Capture the matter, resolve the institution identity and hand the case to the accountable Bureau. A name alone never auto-links to an institution record."
      />

      <form onSubmit={submit} className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader
              title="Complaint details"
              subtitle="These fields drive categorisation, priority and the initial SLA deadline."
              icon={<FilePlus2 className="h-4 w-4" />}
            />
            <div className="space-y-4 p-5">
              {error && <InlineAlert tone="danger">{error}</InlineAlert>}

              <Field label="Complaint title" required>
                <Input
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  placeholder="Short, specific summary of the grievance"
                  maxLength={240}
                />
              </Field>

              <Field label="Description" required hint="At least 20 characters. Include dates, documents and prior correspondence where relevant.">
                <Textarea
                  className="min-h-36"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="What happened, what has already been done, and what outcome is sought?"
                  maxLength={20000}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category" required>
                  <Select
                    value={form.categoryId}
                    onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
                  >
                    <option value="">Select a category</option>
                    {(meta.data?.categories ?? []).map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Priority" required>
                  <Select
                    value={form.priority}
                    onChange={(event) => setForm({ ...form, priority: event.target.value })}
                  >
                    {PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {titleize(priority)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Institution identity"
              subtitle="Verified records and exact AICTE IDs link immediately. Everything else enters the identity queue for human review."
              icon={<Fingerprint className="h-4 w-4" />}
            />
            <div className="space-y-4 p-5">
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => switchMode('verified')}
                  className={cn(
                    'rounded-xl border p-4 text-left transition',
                    mode === 'verified'
                      ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-200'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <CheckCircle2 className="h-4 w-4 text-primary-600" /> Verified institution
                  </span>
                  <span className="mt-1 block text-xs text-slate-600">
                    Select an existing record with a stable AICTE Permanent ID.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('unverified')}
                  className={cn(
                    'rounded-xl border p-4 text-left transition',
                    mode === 'unverified'
                      ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-200'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <ShieldQuestion className="h-4 w-4 text-amber-600" /> Unverified intake
                  </span>
                  <span className="mt-1 block text-xs text-slate-600">
                    Capture the supplied name and route the identity to authorised review.
                  </span>
                </button>
              </div>

              {mode === 'verified' ? (
                <div className="space-y-3">
                  <Field label="Search the institution directory" hint="Search by name, AICTE Permanent ID, city, district or alias.">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        className="pl-9"
                        value={institutionSearch}
                        onChange={(event) => setInstitutionSearch(event.target.value)}
                        placeholder="e.g. DEMO-123456 or ABC Engineering"
                      />
                    </div>
                  </Field>
                  <Field label="Verified institution" required>
                    <Select
                      value={form.institutionId}
                      onChange={(event) => setForm({ ...form, institutionId: event.target.value })}
                    >
                      <option value="">Select a verified institution</option>
                      {([...(meta.data?.institutions ?? []), ...(directory.data ?? [])]
                        .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index))
                        .map((institution) => (
                          <option key={institution.id} value={institution.id}>
                            {institution.name} · {institution.aictePermanentId}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  {directory.loading && <p className="text-xs text-slate-500">Searching directory…</p>}
                  {selectedInstitution && (
                    <InlineAlert tone="success" title="Identity will be linked at intake">
                      <p className="text-sm">
                        {selectedInstitution.name} · AICTE ID {selectedInstitution.aictePermanentId}
                      </p>
                      <p className="mt-1 text-xs">
                        {[selectedInstitution.city, selectedInstitution.district, selectedInstitution.state]
                          .filter(Boolean)
                          .join(', ') || 'Location not recorded'}
                      </p>
                    </InlineAlert>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Institution name as supplied" required>
                      <Input
                        value={form.originalInstitutionName}
                        onChange={(event) => {
                          setForm({ ...form, originalInstitutionName: event.target.value });
                          setConfirmedCandidate(false);
                        }}
                        placeholder="e.g. ABC Engineering Institute"
                      />
                    </Field>
                    <Field label="AICTE Permanent ID (if known)" hint="An exact match links automatically. A near match does not.">
                      <Input
                        value={form.institutionAictePermanentId}
                        onChange={(event) => {
                          setForm({ ...form, institutionAictePermanentId: event.target.value });
                          setConfirmedCandidate(false);
                        }}
                        placeholder="e.g. DEMO-123456"
                      />
                    </Field>
                  </div>
                  <Field label="Intake review note" hint="Optional context for the identity reviewer.">
                    <Textarea
                      className="min-h-20"
                      value={form.identityReviewNote}
                      onChange={(event) => setForm({ ...form, identityReviewNote: event.target.value })}
                      placeholder="Where did this name come from? Any documents supporting the institution?"
                    />
                  </Field>

                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                      <ShieldQuestion className="h-4 w-4" /> Explainable suggestions only
                    </p>
                    <p className="mt-1 text-xs text-amber-800">
                      Names and aliases never link a case. Selecting a suggestion records it as verified; otherwise the
                      case stays in the identity queue until an authorised officer confirms the stable AICTE ID.
                    </p>
                  </div>

                  {preview.loading && <p className="text-xs text-slate-500">Matching against the institution directory…</p>}
                  {preview.error && <InlineAlert tone="warning">{preview.error}</InlineAlert>}
                  {!preview.loading && suggestedCandidates.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Possible matches ({suggestedCandidates.length})
                      </p>
                      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                        {suggestedCandidates.map((candidate) => (
                          <li key={candidate.institution.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-slate-900">
                                {candidate.institution.name}
                              </p>
                              <p className="text-xs text-slate-500">
                                AICTE ID {candidate.institution.aictePermanentId}
                                {[candidate.institution.city, candidate.institution.state].filter(Boolean).length
                                  ? ` · ${[candidate.institution.city, candidate.institution.state].filter(Boolean).join(', ')}`
                                  : ''}
                              </p>
                              {candidate.reasoning && (
                                <p className="mt-1 text-[11px] text-slate-500">{candidate.reasoning}</p>
                              )}
                            </div>
                            <Badge tone={candidate.autoLink ? 'emerald' : candidate.requiresReview ? 'amber' : 'slate'}>
                              {candidate.autoLink ? 'Exact ID' : `${Math.round(candidate.score * 100)}% match`}
                            </Badge>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => chooseCandidate(candidate)}
                            >
                              Use this record
                            </Button>
                          </li>
                        ))}
                      </ul>
                      <Checkbox
                        label="None of these is the institution. Keep this case in the identity queue."
                        checked={confirmedCandidate}
                        onChange={(event) => setConfirmedCandidate(event.target.checked)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Ownership and deadlines"
              subtitle="The Bureau becomes accountable for the next action. The SLA deadline itself always comes from the shared policy."
              icon={<UserCheck className="h-4 w-4" />}
            />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field
                label="Bureau / Cell"
                hint={isBureauOfficer ? 'Bureau officers register within their own Bureau.' : 'Optional at intake; can be assigned later.'}
              >
                <Select
                  value={isBureauOfficer ? user?.bureauId ?? '' : form.currentBureauId}
                  onChange={(event) => setForm({ ...form, currentBureauId: event.target.value, assignedOfficerId: '' })}
                  disabled={isBureauOfficer}
                >
                  <option value="">{isBureauOfficer ? user?.bureau?.name ?? 'Your Bureau' : 'Unassigned'}</option>
                  {!isBureauOfficer &&
                    (meta.data?.bureaus ?? []).map((bureau) => (
                      <option key={bureau.id} value={bureau.id}>
                        {bureau.code} · {bureau.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Assigned officer" hint="Optional. Only officers in the selected Bureau can be assigned.">
                <Select
                  value={form.assignedOfficerId}
                  onChange={(event) => setForm({ ...form, assignedOfficerId: event.target.value })}
                  disabled={!form.currentBureauId && !isBureauOfficer}
                >
                  <option value="">Leave unassigned</option>
                  {(officers.data ?? []).map((officer) => (
                    <option key={officer.id} value={officer.id}>
                      {officer.firstName} {officer.lastName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Next required action">
                <Input
                  value={form.nextRequiredAction}
                  onChange={(event) => setForm({ ...form, nextRequiredAction: event.target.value })}
                  placeholder="e.g. Initial review"
                />
              </Field>
              <Field label="Next action due" hint="Operational date. Does not replace the shared SLA deadline.">
                <Input
                  type="date"
                  value={form.nextActionDueDate}
                  onChange={(event) => setForm({ ...form, nextActionDueDate: event.target.value })}
                />
              </Field>
              <Field label="Expected disposal" hint="Optional planning date; the SLA policy remains authoritative.">
                <Input
                  type="date"
                  value={form.expectedDisposalDate}
                  onChange={(event) => setForm({ ...form, expectedDisposalDate: event.target.value })}
                />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Intake summary" icon={<Building2 className="h-4 w-4" />} />
            <div className="space-y-3 p-5 text-sm">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Institution path</p>
                <p className="mt-1 text-slate-900">
                  {mode === 'verified'
                    ? selectedInstitution?.name ?? 'No verified institution selected'
                    : form.originalInstitutionName || 'Unverified name not supplied'}
                </p>
                {mode === 'unverified' && (
                  <p className="mt-1 text-xs text-amber-700">
                    Will enter the identity queue unless the AICTE ID is an exact match.
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Category</p>
                <p className="mt-1 text-slate-900">
                  {(meta.data?.categories ?? []).find((category) => category.id === form.categoryId)?.name ??
                    'Not selected'}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Priority</p>
                <p className="mt-1 text-slate-900">{titleize(form.priority)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Accountable Bureau</p>
                <p className="mt-1 text-slate-900">
                  {isBureauOfficer
                    ? user?.bureau?.name ?? 'Your Bureau'
                    : (meta.data?.bureaus ?? []).find((bureau) => bureau.id === form.currentBureauId)?.name ??
                      'Unassigned'}
                </p>
              </div>
            </div>
          </Card>

          {meta.error && (
            <Card>
              <EmptyState title="Reference data unavailable" message={meta.error} />
            </Card>
          )}
          {meta.loading && !meta.data && (
            <Card>
              <LoadingBlock label="Loading intake options…" />
            </Card>
          )}

          <Card>
            <div className="space-y-3 p-5">
              <Button type="submit" className="w-full" loading={submitting}>
                Register complaint
              </Button>
              <Link
                to="/cases"
                className="flex h-10 items-center justify-center rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </Link>
              <p className="text-center text-[11px] leading-4 text-slate-400">
                Identity, ownership and SLA are re-validated on the server. The client never decides a deadline or an
                access scope.
              </p>
            </div>
          </Card>
        </div>
      </form>
    </div>
  );
}
