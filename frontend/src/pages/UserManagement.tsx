import { useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Edit3,
  Globe2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCog,
  UserX,
  Users,
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useAsyncData, useDebouncedValue } from '../hooks/useAsyncData';
import { formatDate, getErrorMessage, roleLabel, titleize } from '../lib/format';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatCard,
  cn,
} from '../components/ui';
import type { AdminUser, Bureau, Paginated, Region, Role } from '../services/types';

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'ADMIN', label: 'Administrator' },
  { value: 'BUREAU_OFFICER', label: 'Bureau / Cell Officer' },
  { value: 'REGIONAL_OFFICER', label: 'Regional Officer' },
  { value: 'SENIOR_MANAGEMENT', label: 'Senior Management' },
  { value: 'READ_ONLY', label: 'Read-only Viewer' },
];

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: Role;
  bureauId: string;
  regionId: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  role: 'READ_ONLY',
  bureauId: '',
  regionId: '',
  isActive: true,
};

function roleTone(role: Role): 'teal' | 'blue' | 'violet' | 'amber' | 'slate' {
  if (role === 'ADMIN') return 'teal';
  if (role === 'BUREAU_OFFICER') return 'blue';
  if (role === 'REGIONAL_OFFICER') return 'violet';
  if (role === 'SENIOR_MANAGEMENT') return 'amber';
  return 'slate';
}

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 350);
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const users = useAsyncData<Paginated<AdminUser>>(async () => {
    const params: Record<string, string | number> = { page, pageSize };
    if (debouncedSearch) params.q = debouncedSearch;
    if (roleFilter) params.role = roleFilter;
    if (statusFilter) params.isActive = statusFilter;
    const response = await api.get('/admin/users', { params });
    return response.data as Paginated<AdminUser>;
  }, [debouncedSearch, roleFilter, statusFilter, page, pageSize]);

  const meta = useAsyncData<{ bureaus: Bureau[]; regions: Region[] }>(async () => {
    const [bureaus, regions] = await Promise.all([
      api.get('/admin/bureaus'),
      api.get('/admin/regions'),
    ]);
    return {
      bureaus: (bureaus.data.bureaus ?? []) as Bureau[],
      regions: (regions.data.regions ?? []) as Region[],
    };
  }, []);

  const items = users.data?.items ?? [];
  const total = users.data?.total ?? 0;
  const activeCount = items.filter((item) => item.isActive).length;
  const scopedCount = items.filter((item) => item.bureauId || item.regionId).length;
  const isSelf = Boolean(editing && currentUser?.id === editing.id);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFieldErrors({});
    setModalOpen(true);
  };

  const openEdit = (target: AdminUser) => {
    setEditing(target);
    setForm({
      firstName: target.firstName,
      lastName: target.lastName,
      email: target.email,
      password: '',
      role: target.role,
      bureauId: target.bureauId ?? '',
      regionId: target.regionId ?? '',
      isActive: target.isActive,
    });
    setFormError(null);
    setFieldErrors({});
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
  };

  const updateForm = (patch: Partial<FormState>) => {
    setForm((current) => {
      const next = { ...current, ...patch };
      if (patch.role) {
        if (patch.role !== 'BUREAU_OFFICER') next.bureauId = '';
        if (patch.role !== 'REGIONAL_OFFICER') next.regionId = '';
      }
      return next;
    });
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!form.firstName.trim()) errors.firstName = 'First name is required';
    if (!form.lastName.trim()) errors.lastName = 'Last name is required';
    if (!editing && !form.email.trim()) errors.email = 'Email is required';
    if (!editing && form.password.length < 8) errors.password = 'Password must be at least 8 characters';
    if (editing && form.password && form.password.length < 8) {
      errors.password = 'A new password must be at least 8 characters';
    }
    if (form.role === 'BUREAU_OFFICER' && !form.bureauId) {
      errors.bureauId = 'Select an active Bureau/Cell for a Bureau officer';
    }
    if (form.role === 'REGIONAL_OFFICER' && !form.regionId) {
      errors.regionId = 'Select an active Region for a Regional officer';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        const payload: Record<string, unknown> = {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          role: form.role,
          bureauId: form.role === 'BUREAU_OFFICER' ? form.bureauId : null,
          regionId: form.role === 'REGIONAL_OFFICER' ? form.regionId : null,
          isActive: form.isActive,
        };
        if (form.password) payload.password = form.password;
        await api.patch(`/admin/users/${editing.id}`, payload);
        toast.success(`Updated ${form.firstName} ${form.lastName}.`);
      } else {
        await api.post('/admin/users', {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          password: form.password,
          role: form.role,
          bureauId: form.role === 'BUREAU_OFFICER' ? form.bureauId : null,
          regionId: form.role === 'REGIONAL_OFFICER' ? form.regionId : null,
          isActive: form.isActive,
        });
        toast.success(`Created ${form.firstName} ${form.lastName}.`);
      }
      setModalOpen(false);
      users.reload();
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (target: AdminUser) => {
    try {
      await api.patch(`/admin/users/${target.id}`, { isActive: !target.isActive });
      toast.success(`${target.firstName} ${target.lastName} ${target.isActive ? 'deactivated' : 'reactivated'}.`);
      users.reload();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const clearFilters = () => {
    setSearch('');
    setRoleFilter('');
    setStatusFilter('');
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Users and access"
        subtitle="Account lifecycle and role-scope assignments. A Bureau officer must belong to an active Bureau/Cell and a Regional officer to an active Region; scope is enforced by the server."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => users.reload()} loading={users.loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> New user
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Users in view"
          value={users.data ? total : '—'}
          hint="Matching current filters"
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          label="Active on this page"
          value={users.data ? activeCount : '—'}
          hint="Accounts able to sign in"
          tone="success"
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <StatCard
          label="Scoped on this page"
          value={users.data ? scopedCount : '—'}
          hint="Bureau or Region assignment"
          tone="info"
          icon={<Building2 className="h-5 w-5" />}
        />
        <StatCard
          label="Roles"
          value={ROLE_OPTIONS.length}
          hint="Administrator to read-only"
          icon={<ShieldCheck className="h-5 w-5" />}
        />
      </div>

      <Card className="mb-5">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-12">
          <Field label="Search" className="lg:col-span-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Name or email…"
              />
            </div>
          </Field>
          <Field label="Role" className="lg:col-span-3">
            <Select
              value={roleFilter}
              onChange={(event) => {
                setRoleFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All roles</option>
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Account state" className="lg:col-span-2">
            <Select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All states</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
          </Field>
          <div className="flex items-end lg:col-span-2">
            <Button variant="ghost" className="w-full" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        </div>
      </Card>

      {users.error ? (
        <Card>
          <ErrorBlock message={users.error} onRetry={users.reload} />
        </Card>
      ) : users.loading && !users.data ? (
        <Card>
          <LoadingBlock label="Loading user accounts…" />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title="No users match these filters"
            message="Adjust the search or filters, or create a new account with a consistent role and scope."
            icon={<UserX className="h-6 w-6" />}
            action={
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" /> New user
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">User</th>
                  <th className="px-5 py-3 font-semibold">Role</th>
                  <th className="px-5 py-3 font-semibold">Scope</th>
                  <th className="px-5 py-3 font-semibold">State</th>
                  <th className="px-5 py-3 font-semibold">Created</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((target) => {
                  const self = target.id === currentUser?.id;
                  return (
                    <tr key={target.id} className={cn(!target.isActive && 'bg-slate-50/70')}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-bold text-primary-700">
                            {target.firstName[0]}
                            {target.lastName[0]}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-900">
                              {target.firstName} {target.lastName}
                              {self && <span className="ml-2 text-[11px] font-medium text-slate-400">(you)</span>}
                            </p>
                            <p className="truncate text-xs text-slate-500">{target.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={roleTone(target.role)}>{roleLabel(target.role)}</Badge>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-600">
                        {target.bureau ? (
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="h-3.5 w-3.5 text-slate-400" />
                            {target.bureau.name}
                          </span>
                        ) : target.region ? (
                          <span className="inline-flex items-center gap-1">
                            <Globe2 className="h-3.5 w-3.5 text-slate-400" />
                            {target.region.name}
                          </span>
                        ) : (
                          <span className="text-slate-400">All AICTE</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={target.isActive ? 'emerald' : 'red'}>
                          {target.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">{formatDate(target.createdAt)}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(target)} title="Edit user">
                            <Edit3 className="h-4 w-4" /> Edit
                          </Button>
                          <Button
                            variant={target.isActive ? 'ghost' : 'outline'}
                            size="sm"
                            onClick={() => void toggleActive(target)}
                            disabled={self}
                            title={self ? 'You cannot deactivate your own account' : undefined}
                          >
                            {target.isActive ? <UserX className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                            {target.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? 'Edit user' : 'Create user'}
        description={
          editing
            ? 'Update identity, role, scope or account state. Leave the password blank to keep the current one.'
            : 'Create an account with a role and the scope that role requires.'
        }
        footer={
          <>
            <Button variant="outline" onClick={closeModal} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="user-form" loading={saving}>
              {editing ? 'Save changes' : 'Create user'}
            </Button>
          </>
        }
      >
        <form id="user-form" onSubmit={save} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{formError}</div>
          )}

          {isSelf && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              You are editing your own account. Your role and active state are protected by the server to avoid
              locking yourself out.
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="user-first-name" required error={fieldErrors.firstName}>
              <Input
                id="user-first-name"
                value={form.firstName}
                onChange={(event) => updateForm({ firstName: event.target.value })}
                disabled={saving}
              />
            </Field>
            <Field label="Last name" htmlFor="user-last-name" required error={fieldErrors.lastName}>
              <Input
                id="user-last-name"
                value={form.lastName}
                onChange={(event) => updateForm({ lastName: event.target.value })}
                disabled={saving}
              />
            </Field>
          </div>

          <Field
            label="Email"
            htmlFor="user-email"
            required={!editing}
            hint={editing ? 'Email is the login identifier and cannot be changed here.' : undefined}
            error={fieldErrors.email}
          >
            <Input
              id="user-email"
              type="email"
              value={form.email}
              onChange={(event) => updateForm({ email: event.target.value })}
              disabled={saving || Boolean(editing)}
              autoComplete="off"
            />
          </Field>

          <Field
            label={editing ? 'New password (optional)' : 'Temporary password'}
            htmlFor="user-password"
            required={!editing}
            hint="At least 8 characters. Share it through a secure channel."
            error={fieldErrors.password}
          >
            <Input
              id="user-password"
              type="password"
              value={form.password}
              onChange={(event) => updateForm({ password: event.target.value })}
              disabled={saving}
              autoComplete="new-password"
            />
          </Field>

          <Field label="Role" htmlFor="user-role" required>
            <Select
              id="user-role"
              value={form.role}
              onChange={(event) => updateForm({ role: event.target.value as Role })}
              disabled={saving || isSelf}
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          {form.role === 'BUREAU_OFFICER' && (
            <Field
              label="Bureau / Cell"
              htmlFor="user-bureau"
              required
              hint="Only an active Bureau assignment can be selected."
              error={fieldErrors.bureauId}
            >
              <Select
                id="user-bureau"
                value={form.bureauId}
                onChange={(event) => updateForm({ bureauId: event.target.value })}
                disabled={saving}
              >
                <option value="">Select a Bureau/Cell…</option>
                {(meta.data?.bureaus ?? [])
                  .filter((bureau) => bureau.isActive)
                  .map((bureau) => (
                    <option key={bureau.id} value={bureau.id}>
                      {bureau.name} ({bureau.code})
                    </option>
                  ))}
              </Select>
            </Field>
          )}

          {form.role === 'REGIONAL_OFFICER' && (
            <Field
              label="Region"
              htmlFor="user-region"
              required
              hint="Only an active Region can be selected."
              error={fieldErrors.regionId}
            >
              <Select
                id="user-region"
                value={form.regionId}
                onChange={(event) => updateForm({ regionId: event.target.value })}
                disabled={saving}
              >
                <option value="">Select a Region…</option>
                {(meta.data?.regions ?? [])
                  .filter((region) => region.isActive)
                  .map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name} ({region.code})
                    </option>
                  ))}
              </Select>
            </Field>
          )}

          {form.role !== 'BUREAU_OFFICER' && form.role !== 'REGIONAL_OFFICER' && (
            <p className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <UserCog className="h-4 w-4 shrink-0 text-slate-400" />
              {titleize(form.role)} accounts operate with the AICTE-wide scope and carry no Bureau or Region
              assignment.
            </p>
          )}

          <Checkbox
            label="Account is active"
            checked={form.isActive}
            onChange={(event) => updateForm({ isActive: event.target.checked })}
            disabled={saving || isSelf}
          />
        </form>
      </Modal>
    </div>
  );
}
