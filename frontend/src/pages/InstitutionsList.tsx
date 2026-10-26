import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Building2,
  Filter,
  MapPin,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import api from '../services/api';
import { canManageInstitutions, useAuth } from '../contexts/AuthContext';
import { useAsyncData } from '../hooks/useAsyncData';
import { getErrorMessage, safeParseJson } from '../lib/format';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorBlock,
  Field,
  InlineAlert,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatCard,
} from '../components/ui';
import type { Institution, Paginated, Region } from '../services/types';

interface Filters {
  q: string;
  regionId: string;
  active: 'all' | 'true' | 'false';
}

interface DuplicateCandidate {
  id: string;
  name: string;
  aictePermanentId: string;
  score?: number;
  reasoning?: string | null;
}

const EMPTY_FORM = {
  aictePermanentId: '',
  name: '',
  alternateNames: '',
  institutionType: '',
  address: '',
  city: '',
  district: '',
  state: '',
  regionId: '',
  pinCode: '',
};

export default function InstitutionsList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const canManage = canManageInstitutions(user?.role);

  const [filters, setFilters] = useState<Filters>({ q: '', regionId: '', active: 'true' });
  const [draft, setDraft] = useState<Filters>(filters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  const meta = useAsyncData(async () => {
    const response = await api.get('/institutions/meta/regions');
    return (response.data.regions ?? []) as Region[];
  }, []);

  const list = useAsyncData<Paginated<Institution>>(async () => {
    const params: Record<string, string | number | boolean> = { page, pageSize, sortBy: 'name' };
    if (filters.q) params.q = filters.q;
    if (filters.regionId) params.regionId = filters.regionId;
    if (filters.active !== 'all') params.isActive = filters.active === 'true';
    const response = await api.get('/institutions', { params });
    return response.data as Paginated<Institution>;
  }, [filters, page, pageSize]);

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setFilters(draft);
    setPage(1);
  };

  const resetFilters = () => {
    const cleared: Filters = { q: '', regionId: '', active: 'true' };
    setDraft(cleared);
    setFilters(cleared);
    setPage(1);
  };

  const openCreate = () => {
    setForm({
      ...EMPTY_FORM,
      regionId: user?.role === 'REGIONAL_OFFICER' ? user.regionId ?? '' : '',
    });
    setDuplicates([]);
    setDuplicateId(null);
    setConfirmed(false);
    setJustification('');
    setModalError('');
    setModalOpen(true);
  };

  const closeCreate = () => {
    if (busy) return;
    setModalOpen(false);
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setModalError('');
    try {
      const payload: Record<string, unknown> = {
        aictePermanentId: form.aictePermanentId.trim(),
        name: form.name.trim(),
        alternateNames: form.alternateNames
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        institutionType: form.institutionType.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        district: form.district.trim() || null,
        state: form.state.trim() || null,
        regionId: form.regionId || null,
        pinCode: form.pinCode.trim() || null,
      };
      if (duplicates.length > 0 && confirmed && justification.trim()) {
        payload.confirmPotentialDuplicate = true;
        payload.duplicateJustification = justification.trim();
      }
      const response = await api.post('/institutions', payload);
      toast.success('Institution record created.');
      setModalOpen(false);
      window.dispatchEvent(new Event('aicte:refresh'));
      list.reload();
      const created = response.data.institution as Institution;
      navigate(`/institutions/${created.id}`);
    } catch (err) {
      const response = (err as {
        response?: { status?: number; data?: { error?: { message?: string; details?: unknown } } };
      }).response;
      const details = safeParseJson(response?.data?.error?.details) as
        | { candidates?: DuplicateCandidate[]; institutionId?: string }
        | DuplicateCandidate[]
        | null;
      if (response?.status === 409 && details) {
        if (Array.isArray(details) && details.length > 0) {
          setDuplicates(details);
          setModalError('Potential duplicate records were found. Review them before creating another record.');
        } else if (!Array.isArray(details) && details.institutionId) {
          setDuplicateId(details.institutionId);
          setModalError('This AICTE Permanent ID already exists. Open the existing record instead of creating a duplicate.');
        } else if (!Array.isArray(details) && details.candidates?.length) {
          setDuplicates(details.candidates);
          setModalError('Potential duplicate records were found. Review them before creating another record.');
        } else {
          setModalError(getErrorMessage(err));
        }
      } else {
        setModalError(getErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Institution registry"
        title="Institution directory"
        subtitle="One authoritative record per institution, keyed by the stable AICTE Permanent ID. Names and aliases are explanatory, never identity."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={list.reload} loading={list.loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            {canManage && (
              <Button size="sm" onClick={openCreate}>
                <PlusCircle className="h-4 w-4" /> Add institution
              </Button>
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Records in view"
          value={list.data?.total ?? '—'}
          hint="Matches the current filters"
          icon={<Building2 className="h-5 w-5" />}
        />
        <StatCard
          label="Active filter"
          value={filters.active === 'all' ? 'All' : filters.active === 'true' ? 'Active' : 'Inactive'}
          hint="Inactive records are retained for history"
          tone="info"
          icon={<Filter className="h-5 w-5" />}
        />
        <StatCard
          label="Identity policy"
          value="ID-first"
          hint="Aliases need review and can never auto-link a case"
          tone="warning"
          icon={<ShieldAlert className="h-5 w-5" />}
        />
      </div>

      <Card className="mb-5">
        <form onSubmit={applyFilters} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-12">
          <Field label="Search" className="lg:col-span-6">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="pl-9"
                value={draft.q}
                onChange={(event) => setDraft({ ...draft, q: event.target.value })}
                placeholder="Name, AICTE Permanent ID, alias, city, district, PIN…"
              />
            </div>
          </Field>
          <Field label="Region" className="lg:col-span-3">
            <Select
              value={draft.regionId}
              onChange={(event) => setDraft({ ...draft, regionId: event.target.value })}
            >
              <option value="">All regions</option>
              {(meta.data ?? []).map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" className="lg:col-span-3">
            <Select
              value={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.target.value as Filters['active'] })}
            >
              <option value="true">Active only</option>
              <option value="false">Inactive only</option>
              <option value="all">All records</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-12">
            <Button type="button" variant="ghost" onClick={resetFilters}>
              Clear
            </Button>
            <Button type="submit">Apply filters</Button>
          </div>
        </form>
      </Card>

      <Card>
        {list.error ? (
          <ErrorBlock message={list.error} onRetry={list.reload} />
        ) : list.loading && !list.data ? (
          <LoadingBlock label="Loading institutions…" />
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState
            title="No institution records match"
            message="Adjust the search or add a new institution record."
            icon={<Building2 className="h-6 w-6" />}
            action={canManage ? <Button onClick={openCreate}>Add institution</Button> : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[900px] divide-y divide-slate-100 text-left">
                <thead className="bg-slate-50/80">
                  <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 font-semibold">Institution</th>
                    <th className="px-4 py-3 font-semibold">AICTE Permanent ID</th>
                    <th className="px-4 py-3 font-semibold">Region / location</th>
                    <th className="px-4 py-3 font-semibold">Cases</th>
                    <th className="px-4 py-3 font-semibold">Alerts</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.data.items.map((institution) => (
                    <tr key={institution.id} className="transition hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold text-slate-900">{institution.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {institution.institutionType ?? 'Institution'}
                          {institution.aliases?.length ? ` · ${institution.aliases.length} alias(es)` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-slate-700">{institution.aictePermanentId}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <p>{institution.region?.name ?? 'No region'}</p>
                        <p className="text-[11px] text-slate-400">
                          {[institution.city, institution.district, institution.state].filter(Boolean).join(', ') ||
                            'Location not recorded'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                        {institution._count?.cases ?? 0}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                        {institution._count?.alerts ?? 0}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={institution.isActive ? 'emerald' : 'slate'}>
                          {institution.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/institutions/${institution.id}`}
                          className="text-xs font-semibold text-primary-700 hover:underline"
                        >
                          Open 360
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 lg:hidden">
              {list.data.items.map((institution) => (
                <Link
                  key={institution.id}
                  to={`/institutions/${institution.id}`}
                  className="block p-4 transition hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{institution.name}</p>
                      <p className="text-xs text-slate-500">AICTE ID {institution.aictePermanentId}</p>
                    </div>
                    <Badge tone={institution.isActive ? 'emerald' : 'slate'}>
                      {institution.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" />
                    {[institution.city, institution.state].filter(Boolean).join(', ') || 'Location not recorded'}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {institution._count?.cases ?? 0} case(s) · {institution._count?.alerts ?? 0} alert(s)
                  </p>
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

      <Modal
        open={modalOpen}
        onClose={closeCreate}
        title="Add institution record"
        description="The AICTE Permanent ID is the identity key. A name alone is not proof of identity."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={closeCreate} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const formElement = document.getElementById('create-institution-form') as HTMLFormElement | null;
                formElement?.requestSubmit();
              }}
              loading={busy}
              variant={duplicates.length > 0 ? 'danger' : 'primary'}
              disabled={duplicates.length > 0 && (!confirmed || justification.trim().length < 5)}
            >
              {duplicates.length > 0 ? 'Create anyway' : 'Create institution'}
            </Button>
          </>
        }
      >
        <form id="create-institution-form" onSubmit={create} className="space-y-4">
          {modalError && <InlineAlert tone="danger">{modalError}</InlineAlert>}

          {duplicateId && (
            <InlineAlert tone="warning" title="Existing AICTE Permanent ID">
              <Link to={`/institutions/${duplicateId}`} className="font-semibold underline">
                Open the existing institution record
              </Link>{' '}
              instead of creating a duplicate.
            </InlineAlert>
          )}

          {duplicates.length > 0 && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangle className="h-4 w-4" /> Potential duplicates
              </p>
              <ul className="space-y-2">
                {duplicates.map((candidate) => (
                  <li key={candidate.id} className="rounded-lg border border-amber-200 bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-900">{candidate.name}</p>
                        <p className="text-xs text-slate-500">AICTE ID {candidate.aictePermanentId}</p>
                      </div>
                      <Link
                        to={`/institutions/${candidate.id}`}
                        className="text-xs font-semibold text-primary-700 hover:underline"
                      >
                        Review record
                      </Link>
                    </div>
                    {candidate.reasoning && <p className="mt-1 text-xs text-slate-600">{candidate.reasoning}</p>}
                  </li>
                ))}
              </ul>
              <Checkbox
                label="I reviewed these candidates and confirmed this is a genuinely separate institution."
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <Field label="Justification" required hint="Recorded in the audit trail. At least 5 characters.">
                <Input
                  value={justification}
                  onChange={(event) => setJustification(event.target.value)}
                  placeholder="Why is this a new record rather than one of the candidates?"
                />
              </Field>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Institution name" required>
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Full registered name"
              />
            </Field>
            <Field label="AICTE Permanent ID" required>
              <Input
                value={form.aictePermanentId}
                onChange={(event) => setForm({ ...form, aictePermanentId: event.target.value })}
                placeholder="e.g. DEMO-123456"
              />
            </Field>
            <Field label="Alternate names" hint="Comma-separated. Stored as aliases for explainable matching." className="sm:col-span-2">
              <Input
                value={form.alternateNames}
                onChange={(event) => setForm({ ...form, alternateNames: event.target.value })}
                placeholder="e.g. ABC Engineering Institute, ABCEC"
              />
            </Field>
            <Field label="Institution type">
              <Input
                value={form.institutionType}
                onChange={(event) => setForm({ ...form, institutionType: event.target.value })}
                placeholder="e.g. Engineering College"
              />
            </Field>
            <Field label="Region">
              <Select
                value={form.regionId}
                onChange={(event) => setForm({ ...form, regionId: event.target.value })}
                disabled={user?.role === 'REGIONAL_OFFICER'}
              >
                <option value="">No region</option>
                {(meta.data ?? []).map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name} ({region.code})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Input
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
                placeholder="Street address"
              />
            </Field>
            <Field label="City">
              <Input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
            </Field>
            <Field label="District">
              <Input
                value={form.district}
                onChange={(event) => setForm({ ...form, district: event.target.value })}
              />
            </Field>
            <Field label="State">
              <Input value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} />
            </Field>
            <Field label="PIN code" hint="Six digits.">
              <Input
                value={form.pinCode}
                onChange={(event) => setForm({ ...form, pinCode: event.target.value })}
                inputMode="numeric"
                maxLength={6}
              />
            </Field>
          </div>
          <p className="text-[11px] text-slate-400">
            Creating a record is audited. Existing records can be edited and merged; history is never deleted.
          </p>
        </form>
      </Modal>
    </div>
  );
}
