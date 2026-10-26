import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Fingerprint,
  Inbox,
  RefreshCw,
  Search,
  ShieldQuestion,
  XCircle,
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useAsyncData, useDebouncedValue } from '../hooks/useAsyncData';
import { formatDate, formatDateTime, getErrorMessage, titleize } from '../lib/format';
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
  Modal,
  PageHeader,
  Pagination,
  PriorityBadge,
  Select,
  StatCard,
  StatusBadge,
  Textarea,
} from '../components/ui';
import type { IdentityResolution, Institution, Paginated } from '../services/types';

interface IdentityStats {
  pending: number;
  resolved: number;
  dismissed: number;
}

export default function IdentityQueue() {
  const { user } = useAuth();
  const toast = useToast();
  const canResolve = user?.role === 'ADMIN' || user?.role === 'REGIONAL_OFFICER';

  const [status, setStatus] = useState('PENDING');
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [selected, setSelected] = useState<IdentityResolution | null>(null);
  const [institutionId, setInstitutionId] = useState('');
  const [note, setNote] = useState('');
  const [dismissing, setDismissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState('');
  const [institutionSearch, setInstitutionSearch] = useState('');
  const debouncedInstitutionSearch = useDebouncedValue(institutionSearch, 300);

  const stats = useAsyncData(async () => {
    const response = await api.get('/institutions/identity/stats');
    return response.data.stats as IdentityStats;
  }, []);

  const list = useAsyncData<Paginated<IdentityResolution>>(async () => {
    const response = await api.get('/institutions/identity/queue', {
      params: {
        status,
        q: query || undefined,
        page,
        pageSize,
      },
    });
    return response.data as Paginated<IdentityResolution>;
  }, [status, query, page, pageSize]);

  const searchResults = useAsyncData(async () => {
    if (!selected || debouncedInstitutionSearch.trim().length < 2) return [] as Institution[];
    const response = await api.get('/institutions', {
      params: { q: debouncedInstitutionSearch.trim(), pageSize: 20, isActive: true },
    });
    return (response.data.items ?? []) as Institution[];
  }, [selected?.id, debouncedInstitutionSearch]);

  const refreshAll = () => {
    list.reload();
    stats.reload();
    window.dispatchEvent(new Event('aicte:refresh'));
  };

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault();
    setQuery(draftQuery);
    setPage(1);
  };

  const openResolution = (item: IdentityResolution, dismiss: boolean) => {
    setSelected(item);
    setInstitutionId(item.candidateEvidence?.candidates?.[0]?.institutionId ?? '');
    setInstitutionSearch('');
    setNote('');
    setDismissing(dismiss);
    setModalError('');
  };

  const closeModal = () => {
    if (busy) return;
    setSelected(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    if (dismissing && note.trim().length < 5) {
      setModalError('A dismissal note of at least 5 characters is required.');
      return;
    }
    if (!dismissing && !institutionId) {
      setModalError('Select the verified institution for this case.');
      return;
    }
    setBusy(true);
    setModalError('');
    try {
      await api.post(`/institutions/identity/${selected.id}/resolve`, {
        ...(dismissing ? { dismiss: true } : { institutionId }),
        note: note.trim() || null,
      });
      toast.success(
        dismissing
          ? 'Identity request dismissed with a recorded reason. The case remains unverified.'
          : 'Institution identity verified. Institution-level metrics now include this case.',
      );
      setSelected(null);
      refreshAll();
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const candidates = selected?.candidateEvidence?.candidates ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="Data integrity"
        title="Institution identity queue"
        subtitle="Unresolved intake names. Names and aliases never auto-link; an authorised officer must confirm the stable AICTE Permanent ID."
        actions={
          <Button variant="outline" size="sm" onClick={refreshAll} loading={list.loading || stats.loading}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Pending review"
          value={stats.data?.pending ?? '—'}
          hint="Excluded from institution metrics"
          tone="warning"
          icon={<Fingerprint className="h-5 w-5" />}
        />
        <StatCard
          label="Resolved"
          value={stats.data?.resolved ?? '—'}
          hint="Verified against a stable AICTE ID"
          tone="success"
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <StatCard
          label="Dismissed"
          value={stats.data?.dismissed ?? '—'}
          hint="Kept unverified with a recorded reason"
          icon={<XCircle className="h-5 w-5" />}
        />
      </div>

      <Card className="mb-5">
        <form onSubmit={applySearch} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-12">
          <Field label="Search" className="lg:col-span-7">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="pl-9"
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
                placeholder="Case number, title, submitted name or AICTE ID…"
              />
            </div>
          </Field>
          <Field label="Status" className="lg:col-span-3">
            <Select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="PENDING">Pending</option>
              <option value="RESOLVED">Resolved</option>
              <option value="DISMISSED">Dismissed</option>
              <option value="PENDING,RESOLVED,DISMISSED">All statuses</option>
            </Select>
          </Field>
          <div className="flex items-end lg:col-span-2">
            <Button type="submit" className="w-full">
              Search
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
          <LoadingBlock label="Loading identity queue…" />
        </Card>
      ) : !list.data || list.data.items.length === 0 ? (
        <Card>
          <EmptyState
            title="Identity queue is clear"
            message="No intake record matches these filters. New unverified names will appear here automatically."
            icon={<Inbox className="h-6 w-6" />}
          />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Identity review requests"
            subtitle={`${list.data.total} record(s) match the current filters`}
            icon={<ShieldQuestion className="h-4 w-4" />}
          />
          <ul className="divide-y divide-slate-100">
            {list.data.items.map((item) => (
              <li key={item.id} className="p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={item.status} />
                      {item.case && (
                        <Link
                          to={`/cases/${item.case.id}`}
                          className="text-xs font-semibold text-primary-700 hover:underline"
                        >
                          {item.case.caseNumber}
                        </Link>
                      )}
                      {item.case && <PriorityBadge priority={item.case.priority} />}
                      <span className="text-[11px] text-slate-400">
                        Raised {formatDateTime(item.createdAt)}
                      </span>
                    </div>
                    {item.case && (
                      <p className="mt-1 text-sm font-semibold text-slate-900">{item.case.title}</p>
                    )}
                    <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                      <p>
                        <span className="font-semibold text-slate-700">Submitted name:</span> {item.submittedName}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-700">Submitted AICTE ID:</span>{' '}
                        {item.submittedAictePermanentId ?? 'Not supplied'}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-700">Bureau:</span>{' '}
                        {item.case?.currentBureau?.name ?? 'Unassigned'}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-700">Raised by:</span>{' '}
                        {item.case?.createdBy
                          ? `${item.case.createdBy.firstName} ${item.case.createdBy.lastName}`
                          : '—'}
                      </p>
                    </div>

                    {item.status === 'PENDING' && (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Explainable candidates ({candidates.length})
                        </p>
                        {candidates.length === 0 ? (
                          <p className="mt-1 text-xs text-slate-500">
                            No candidate was close enough. Search the directory to verify the correct record.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-1.5">
                            {candidates.map((candidate) => (
                              <li
                                key={candidate.institutionId}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-2.5 py-1.5"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-xs font-semibold text-slate-800">
                                    {candidate.name}
                                  </span>
                                  <span className="text-[11px] text-slate-500">
                                    AICTE ID {candidate.aictePermanentId}
                                  </span>
                                </span>
                                <Badge tone={candidate.autoLink ? 'emerald' : candidate.requiresReview ? 'amber' : 'slate'}>
                                  {candidate.autoLink ? 'Exact ID' : `${Math.round(candidate.score * 100)}% match`}
                                </Badge>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-2 text-[11px] text-slate-500">
                          {item.candidateEvidence?.policy ??
                            'Names and aliases never auto-link. Confirm the stable AICTE Permanent ID.'}
                        </p>
                      </div>
                    )}

                    {item.status !== 'PENDING' && (
                      <div className="mt-3 rounded-lg border border-slate-200 p-3 text-xs text-slate-600">
                        <p>
                          <span className="font-semibold text-slate-700">Outcome:</span> {titleize(item.status)}
                        </p>
                        {item.resolvedInstitution && (
                          <p className="mt-1">
                            <span className="font-semibold text-slate-700">Verified institution:</span>{' '}
                            <Link
                              to={`/institutions/${item.resolvedInstitution.id}`}
                              className="font-semibold text-primary-700 hover:underline"
                            >
                              {item.resolvedInstitution.name} ({item.resolvedInstitution.aictePermanentId})
                            </Link>
                          </p>
                        )}
                        {item.resolvedBy && (
                          <p className="mt-1">
                            <span className="font-semibold text-slate-700">Reviewed by:</span>{' '}
                            {item.resolvedBy.firstName} {item.resolvedBy.lastName}
                            {item.resolvedAt ? ` on ${formatDateTime(item.resolvedAt)}` : ''}
                          </p>
                        )}
                        {item.resolutionNote && (
                          <p className="mt-1">
                            <span className="font-semibold text-slate-700">Note:</span> {item.resolutionNote}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-2 lg:w-48">
                    {item.case && (
                      <Link
                        to={`/cases/${item.case.id}`}
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        Open case <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                    {item.status === 'PENDING' && canResolve && (
                      <>
                        <Button size="sm" onClick={() => openResolution(item, false)}>
                          Verify identity
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openResolution(item, true)}>
                          Dismiss request
                        </Button>
                      </>
                    )}
                    {item.status === 'PENDING' && !canResolve && (
                      <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                        An administrator or regional officer must resolve this identity.
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
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
      )}

      <Modal
        open={Boolean(selected)}
        onClose={closeModal}
        title={dismissing ? 'Dismiss identity request' : 'Verify institution identity'}
        description={
          selected
            ? `${selected.case?.caseNumber ?? 'Case'} · submitted as “${selected.submittedName}”`
            : undefined
        }
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={dismissing ? 'danger' : 'primary'}
              onClick={() => {
                const formElement = document.getElementById('identity-form') as HTMLFormElement | null;
                formElement?.requestSubmit();
              }}
              loading={busy}
            >
              {dismissing ? 'Dismiss with reason' : 'Confirm identity'}
            </Button>
          </>
        }
      >
        <form id="identity-form" onSubmit={submit} className="space-y-4">
          {modalError && <InlineAlert tone="danger">{modalError}</InlineAlert>}

          {dismissing ? (
            <InlineAlert tone="warning" title="Dismissal keeps the case unverified">
              The case remains outside institution-level metrics. A meaningful note is mandatory and is written to the
              case history.
            </InlineAlert>
          ) : (
            <>
              {candidates.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suggested candidates</p>
                  <div className="space-y-1.5">
                    {candidates.map((candidate) => (
                      <label
                        key={candidate.institutionId}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition ${
                          institutionId === candidate.institutionId
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="candidate"
                          className="mt-1 h-4 w-4 text-primary-700"
                          checked={institutionId === candidate.institutionId}
                          onChange={() => setInstitutionId(candidate.institutionId)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-slate-900">{candidate.name}</span>
                          <span className="block text-xs text-slate-500">
                            AICTE ID {candidate.aictePermanentId}
                            {[candidate.city, candidate.state].filter(Boolean).length
                              ? ` · ${[candidate.city, candidate.state].filter(Boolean).join(', ')}`
                              : ''}
                          </span>
                          {candidate.reasoning && (
                            <span className="mt-1 block text-[11px] text-slate-500">{candidate.reasoning}</span>
                          )}
                        </span>
                        <Badge tone={candidate.autoLink ? 'emerald' : 'amber'}>
                          {candidate.autoLink ? 'Exact' : `${Math.round(candidate.score * 100)}%`}
                        </Badge>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <Field
                label="Search the institution directory"
                hint="Use the stable AICTE ID when the suggestion list is inconclusive."
              >
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    className="pl-9"
                    value={institutionSearch}
                    onChange={(event) => setInstitutionSearch(event.target.value)}
                    placeholder="Institution name or AICTE Permanent ID"
                  />
                </div>
              </Field>
              {searchResults.loading && <p className="text-xs text-slate-500">Searching…</p>}
              {(searchResults.data ?? []).length > 0 && (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {(searchResults.data ?? []).map((institution) => (
                    <button
                      key={institution.id}
                      type="button"
                      onClick={() => setInstitutionId(institution.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                        institutionId === institution.id ? 'bg-primary-50 text-primary-900' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{institution.name}</span>
                        <span className="text-slate-500">AICTE ID {institution.aictePermanentId}</span>
                      </span>
                      <span className="shrink-0 text-slate-400">{institution.state ?? ''}</span>
                    </button>
                  ))}
                </div>
              )}

              <Field label="Selected verified institution" required>
                <Select value={institutionId} onChange={(event) => setInstitutionId(event.target.value)}>
                  <option value="">Select a verified record</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.institutionId} value={candidate.institutionId}>
                      {candidate.name} · {candidate.aictePermanentId}
                    </option>
                  ))}
                  {(searchResults.data ?? [])
                    .filter((institution) => !candidates.some((candidate) => candidate.institutionId === institution.id))
                    .map((institution) => (
                      <option key={institution.id} value={institution.id}>
                        {institution.name} · {institution.aictePermanentId}
                      </option>
                    ))}
                </Select>
              </Field>
            </>
          )}

          <Field
            label={dismissing ? 'Dismissal note' : 'Resolution note'}
            required={dismissing}
            hint={
              dismissing
                ? 'At least 5 characters. Explain why the institution cannot be verified.'
                : 'Optional context recorded on the case and in the audit trail.'
            }
          >
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                dismissing
                  ? 'e.g. Complainant did not provide any document confirming the institution.'
                  : 'e.g. Confirmed against the AICTE permanent ID on the admission letter.'
              }
            />
          </Field>

          <p className="text-[11px] text-slate-400">
            Resolving identity also records a case action, writes an audit event and re-evaluates institution overlaps.
            Dates and decisions are server-generated.
          </p>
          <p className="text-[11px] text-slate-400">Requested {selected ? formatDate(selected.createdAt) : '—'}.</p>
        </form>
      </Modal>
    </div>
  );
}
