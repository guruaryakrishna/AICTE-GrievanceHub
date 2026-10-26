import { useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Edit3,
  Layers,
  Plus,
  RefreshCw,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import api from '../services/api';
import { useAsyncData } from '../hooks/useAsyncData';
import { formatHours, getErrorMessage, titleize } from '../lib/format';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorBlock,
  Field,
  InlineAlert,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  StatCard,
} from '../components/ui';
import type { Bureau, Category, SlaRule } from '../services/types';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

const DEFAULTS = {
  warningThresholdHours: 72,
  escalationThresholdHours: 24,
};

interface FormState {
  name: string;
  categoryId: string;
  bureauId: string;
  priority: string;
  slaDurationHours: string;
  warningThresholdHours: string;
  escalationThresholdHours: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  categoryId: '',
  bureauId: '',
  priority: '',
  slaDurationHours: '720',
  warningThresholdHours: String(DEFAULTS.warningThresholdHours),
  escalationThresholdHours: String(DEFAULTS.escalationThresholdHours),
  isActive: true,
};

function appliesTo(rule: SlaRule, categories: Category[], bureaus: Bureau[]): string {
  const parts: string[] = [];
  if (rule.categoryId) {
    parts.push(categories.find((category) => category.id === rule.categoryId)?.name ?? 'Specific category');
  }
  if (rule.bureauId) {
    parts.push(bureaus.find((bureau) => bureau.id === rule.bureauId)?.name ?? 'Specific Bureau');
  }
  if (rule.priority) parts.push(`${titleize(rule.priority)} priority`);
  return parts.length > 0 ? parts.join(' · ') : 'Global fallback';
}

export default function SlaRules() {
  const toast = useToast();

  const data = useAsyncData<{ rules: SlaRule[]; categories: Category[]; bureaus: Bureau[] }>(async () => {
    const [rules, categories, bureaus] = await Promise.all([
      api.get('/admin/sla-rules'),
      api.get('/admin/categories'),
      api.get('/admin/bureaus'),
    ]);
    return {
      rules: (rules.data.rules ?? []) as SlaRule[],
      categories: (categories.data.categories ?? []) as Category[],
      bureaus: (bureaus.data.bureaus ?? []) as Bureau[],
    };
  }, []);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SlaRule | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const rules = data.data?.rules ?? [];
  const categories = data.data?.categories ?? [];
  const bureaus = data.data?.bureaus ?? [];

  const activeRules = rules.filter((rule) => rule.isActive);
  const globalRules = rules.filter((rule) => !rule.categoryId && !rule.bureauId && !rule.priority);
  const specificRules = rules.filter((rule) => rule.categoryId || rule.bureauId || rule.priority);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (rule: SlaRule) => {
    setEditing(rule);
    setForm({
      name: rule.name,
      categoryId: rule.categoryId ?? '',
      bureauId: rule.bureauId ?? '',
      priority: rule.priority ?? '',
      slaDurationHours: String(rule.slaDurationHours),
      warningThresholdHours: String(rule.warningThresholdHours),
      escalationThresholdHours: String(rule.escalationThresholdHours),
      isActive: rule.isActive,
    });
    setFieldErrors({});
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    const duration = Number(form.slaDurationHours);
    const warning = Number(form.warningThresholdHours);
    const escalation = Number(form.escalationThresholdHours);

    if (!form.name.trim()) errors.name = 'A policy name is required';
    if (!Number.isInteger(duration) || duration < 1 || duration > 8760) {
      errors.slaDurationHours = 'Duration must be a whole number between 1 and 8760 hours';
    }
    if (!Number.isInteger(warning) || warning < 0 || warning > 8760) {
      errors.warningThresholdHours = 'Warning threshold must be between 0 and 8760 hours';
    } else if (Number.isInteger(duration) && duration > 0 && warning > duration) {
      errors.warningThresholdHours = 'Warning threshold cannot exceed the SLA duration';
    }
    if (!Number.isInteger(escalation) || escalation < 0 || escalation > 8760) {
      errors.escalationThresholdHours = 'Escalation threshold must be between 0 and 8760 hours';
    } else if (Number.isInteger(warning) && warning >= 0 && escalation > warning) {
      errors.escalationThresholdHours = 'Escalation threshold should not exceed the warning threshold';
    }

    if (rules.some((rule) => {
      if (editing && rule.id === editing.id) return false;
      return (
        rule.isActive &&
        form.isActive &&
        (rule.categoryId ?? '') === form.categoryId &&
        (rule.bureauId ?? '') === form.bureauId &&
        (rule.priority ?? '') === form.priority
      );
    })) {
      errors.name = 'Another active rule already targets this exact combination';
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
      const payload = {
        name: form.name.trim(),
        categoryId: form.categoryId || null,
        bureauId: form.bureauId || null,
        priority: form.priority || null,
        slaDurationHours: Number(form.slaDurationHours),
        warningThresholdHours: Number(form.warningThresholdHours),
        escalationThresholdHours: Number(form.escalationThresholdHours),
        isActive: form.isActive,
      };
      if (editing) {
        await api.patch(`/admin/sla-rules/${editing.id}`, payload);
        toast.success(`Updated SLA policy “${payload.name}”.`);
      } else {
        await api.post('/admin/sla-rules', payload);
        toast.success(`Created SLA policy “${payload.name}”.`);
      }
      setModalOpen(false);
      data.reload();
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (rule: SlaRule) => {
    try {
      await api.patch(`/admin/sla-rules/${rule.id}`, { isActive: !rule.isActive });
      toast.success(`Policy “${rule.name}” ${rule.isActive ? 'deactivated' : 'activated'}.`);
      data.reload();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="SLA policy"
        subtitle="One authoritative policy drives intake deadlines, case badges, dashboards, reports and the scheduled evaluator. The most specific active rule wins; a global rule is the only fallback."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => data.reload()} loading={data.loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> New policy
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Policies"
          value={data.data ? rules.length : '—'}
          hint="All configured rules"
          icon={<Timer className="h-5 w-5" />}
        />
        <StatCard
          label="Active"
          value={data.data ? activeRules.length : '—'}
          hint="Applied to deadlines"
          tone="success"
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <StatCard
          label="Targeted"
          value={data.data ? specificRules.length : '—'}
          hint="Category, Bureau or priority"
          tone="info"
          icon={<Layers className="h-5 w-5" />}
        />
        <StatCard
          label="Global fallbacks"
          value={data.data ? globalRules.length : '—'}
          hint="Used when nothing is more specific"
          tone={globalRules.length > 1 ? 'warning' : 'default'}
          icon={<CalendarClock className="h-5 w-5" />}
        />
      </div>

      <InlineAlert tone="info" className="mb-5">
        A complaint's deadline is the received date plus the SLA duration of the most specific matching active
        policy. Cases become <span className="font-semibold">approaching</span> inside the warning window and are{' '}
        <span className="font-semibold">overdue</span> after the deadline. Disposed cases are never counted as overdue.
        The escalation threshold marks the narrower window used for escalation notifications.
      </InlineAlert>

      {data.error ? (
        <Card>
          <ErrorBlock message={data.error} onRetry={data.reload} />
        </Card>
      ) : data.loading && !data.data ? (
        <Card>
          <LoadingBlock label="Loading SLA policies…" />
        </Card>
      ) : rules.length === 0 ? (
        <Card>
          <EmptyState
            title="No SLA policies configured"
            message="Create a global fallback first, then add targeted policies for categories, Bureaus or priorities."
            icon={<Timer className="h-6 w-6" />}
            action={
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" /> New policy
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Configured policies"
            subtitle="Specificity order: category (4) + Bureau (2) + priority (1), then newest rule."
            icon={<Timer className="h-4 w-4" />}
          />
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Policy</th>
                  <th className="px-5 py-3 font-semibold">Applies to</th>
                  <th className="px-5 py-3 font-semibold">Duration</th>
                  <th className="px-5 py-3 font-semibold">Warning</th>
                  <th className="px-5 py-3 font-semibold">Escalation</th>
                  <th className="px-5 py-3 font-semibold">State</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rules.map((rule) => (
                  <tr key={rule.id} className={!rule.isActive ? 'bg-slate-50/70' : undefined}>
                    <td className="px-5 py-3">
                      <p className="font-semibold text-slate-900">{rule.name}</p>
                      <p className="text-[11px] text-slate-400">{rule.id.slice(0, 10)}…</p>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-600">
                      {appliesTo(rule, categories, bureaus)}
                    </td>
                    <td className="px-5 py-3 font-medium tabular-nums text-slate-900">
                      {formatHours(rule.slaDurationHours)}
                      <span className="ml-1 text-[11px] font-normal text-slate-400">
                        ({rule.slaDurationHours}h)
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-600">{formatHours(rule.warningThresholdHours)}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">{formatHours(rule.escalationThresholdHours)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={rule.isActive ? 'emerald' : 'slate'}>
                        {rule.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(rule)}>
                          <Edit3 className="h-4 w-4" /> Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void toggleActive(rule)}>
                          {rule.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? 'Edit SLA policy' : 'New SLA policy'}
        description="Leave scope fields empty to create a global fallback. A targeted rule only matches its exact category, Bureau and priority."
        footer={
          <>
            <Button variant="outline" onClick={closeModal} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="sla-form" loading={saving}>
              {editing ? 'Save changes' : 'Create policy'}
            </Button>
          </>
        }
      >
        <form id="sla-form" onSubmit={save} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{formError}</div>
          )}

          <Field label="Policy name" htmlFor="sla-name" required error={fieldErrors.name}>
            <Input
              id="sla-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="e.g. Standard complaint resolution"
              disabled={saving}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="sla-category" hint="Empty means any category.">
              <Select
                id="sla-category"
                value={form.categoryId}
                onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
                disabled={saving}
              >
                <option value="">Any category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Bureau / Cell" htmlFor="sla-bureau" hint="Empty means any Bureau.">
              <Select
                id="sla-bureau"
                value={form.bureauId}
                onChange={(event) => setForm({ ...form, bureauId: event.target.value })}
                disabled={saving}
              >
                <option value="">Any Bureau</option>
                {bureaus.map((bureau) => (
                  <option key={bureau.id} value={bureau.id}>
                    {bureau.name} ({bureau.code})
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Priority" htmlFor="sla-priority" hint="Empty means any priority.">
            <Select
              id="sla-priority"
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value })}
              disabled={saving}
            >
              <option value="">Any priority</option>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {titleize(priority)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Duration (hours)" htmlFor="sla-duration" required error={fieldErrors.slaDurationHours}>
              <Input
                id="sla-duration"
                type="number"
                min={1}
                max={8760}
                value={form.slaDurationHours}
                onChange={(event) => setForm({ ...form, slaDurationHours: event.target.value })}
                disabled={saving}
              />
            </Field>
            <Field label="Warning (hours)" htmlFor="sla-warning" required error={fieldErrors.warningThresholdHours}>
              <Input
                id="sla-warning"
                type="number"
                min={0}
                max={8760}
                value={form.warningThresholdHours}
                onChange={(event) => setForm({ ...form, warningThresholdHours: event.target.value })}
                disabled={saving}
              />
            </Field>
            <Field
              label="Escalation (hours)"
              htmlFor="sla-escalation"
              required
              error={fieldErrors.escalationThresholdHours}
            >
              <Input
                id="sla-escalation"
                type="number"
                min={0}
                max={8760}
                value={form.escalationThresholdHours}
                onChange={(event) => setForm({ ...form, escalationThresholdHours: event.target.value })}
                disabled={saving}
              />
            </Field>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <p className="flex items-center gap-1.5 font-semibold text-slate-800">
              <AlertTriangle className="h-3.5 w-3.5" /> Resulting behaviour
            </p>
            <p className="mt-1">
              Due {formatHours(Number(form.slaDurationHours) || 0)} after receipt; approaching within{' '}
              {formatHours(Number(form.warningThresholdHours) || 0)}; escalation window{' '}
              {formatHours(Number(form.escalationThresholdHours) || 0)}.
            </p>
          </div>

          <Checkbox
            label="Policy is active"
            checked={form.isActive}
            onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            disabled={saving}
          />
        </form>
      </Modal>
    </div>
  );
}
