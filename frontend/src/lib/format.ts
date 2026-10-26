import axios from 'axios';

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

export function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return isValidDate(date) ? date : null;
}

export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateInput(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function formatRelative(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  const diffMs = date.getTime() - Date.now();
  const absMinutes = Math.round(Math.abs(diffMs) / 60_000);
  const suffix = diffMs < 0 ? 'ago' : 'from now';
  if (absMinutes < 1) return 'just now';
  if (absMinutes < 60) return `${absMinutes}m ${suffix}`;
  const hours = Math.round(absMinutes / 60);
  if (hours < 48) return `${hours}h ${suffix}`;
  const days = Math.round(hours / 24);
  return `${days}d ${suffix}`;
}

export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return '—';
  const abs = Math.abs(hours);
  if (abs < 24) return `${Math.round(abs)}h`;
  return `${Math.round((abs / 24) * 10) / 10}d`;
}

export function titleize(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function roleLabel(role: string): string {
  switch (role) {
    case 'ADMIN':
      return 'Administrator';
    case 'BUREAU_OFFICER':
      return 'Bureau / Cell Officer';
    case 'REGIONAL_OFFICER':
      return 'Regional Officer';
    case 'SENIOR_MANAGEMENT':
      return 'Senior Management';
    case 'READ_ONLY':
      return 'Read-only Viewer';
    default:
      return titleize(role);
  }
}

export function percent(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(fractionDigits)}%`;
}

export function initials(firstName?: string | null, lastName?: string | null): string {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || '?';
}

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as
      | { error?: { message?: string; details?: unknown } }
      | undefined;
    const message = payload?.error?.message;
    if (message) {
      const details = payload?.error?.details;
      if (Array.isArray(details) && details.length > 0) {
        const first = details[0] as { path?: string; message?: string };
        return first?.message ? `${message}: ${first.message}` : message;
      }
      return message;
    }
    if (error.code === 'ERR_NETWORK') {
      return 'Cannot reach the AICTE service. Check that the backend is running.';
    }
    return error.message || 'Request failed';
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function safeParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function downloadBlob(data: BlobPart, filename: string, type = 'text/csv;charset=utf-8'): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 500);
}
