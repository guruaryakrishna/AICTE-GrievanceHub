import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  BellOff,
  CheckCheck,
  CheckCircle2,
  Inbox,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import api from '../services/api';
import { useAsyncData } from '../hooks/useAsyncData';
import { formatDateTime, getErrorMessage, titleize } from '../lib/format';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Pagination,
  StatCard,
  cn,
} from '../components/ui';
import type { NotificationItem } from '../services/types';

interface NotificationPage {
  items: NotificationItem[];
  total: number;
  unreadCount: number;
}

const TYPE_LABELS: Record<string, string> = {
  CASE_ASSIGNED: 'Assignment',
  CASE_TRANSFERRED: 'Transfer',
  CASE_ESCALATED: 'Escalation',
  CASE_DISPOSED: 'Disposal',
  CASE_REOPENED: 'Reopened',
  SLA_APPROACHING: 'Deadline warning',
  SLA_OVERDUE: 'Overdue',
  ALERT_CREATED: 'Coordination alert',
  ALERT_REVIEWED: 'Alert review',
  IDENTITY_PENDING: 'Identity review',
};

function typeTone(type: string): 'slate' | 'blue' | 'amber' | 'red' | 'teal' | 'emerald' {
  if (type.includes('OVERDUE') || type.includes('ESCALAT')) return 'red';
  if (type.includes('APPROACHING') || type.includes('PENDING')) return 'amber';
  if (type.includes('ALERT')) return 'teal';
  if (type.includes('DISPOSED')) return 'emerald';
  return 'blue';
}

function typeIcon(type: string) {
  if (type.includes('OVERDUE') || type.includes('ESCALAT')) return <ShieldAlert className="h-4 w-4" />;
  if (type.includes('ALERT')) return <AlertCircle className="h-4 w-4" />;
  if (type.includes('DISPOSED')) return <CheckCircle2 className="h-4 w-4" />;
  if (type.includes('ASSIGNED') || type.includes('TRANSFERRED')) return <Send className="h-4 w-4" />;
  return <Bell className="h-4 w-4" />;
}

export default function Notifications() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const list = useAsyncData<NotificationPage>(async () => {
    const response = await api.get('/notifications', {
      params: { page, pageSize, unreadOnly: String(unreadOnly) },
    });
    return response.data as NotificationPage;
  }, [page, pageSize, unreadOnly]);

  const refreshEverything = () => {
    list.reload();
    window.dispatchEvent(new Event('aicte:refresh'));
  };

  const markRead = async (notification: NotificationItem) => {
    if (notification.isRead) return;
    setBusyId(notification.id);
    try {
      await api.post(`/notifications/${notification.id}/read`);
      list.setData((current) =>
        current
          ? {
              ...current,
              unreadCount: Math.max(0, current.unreadCount - 1),
              items: unreadOnly
                ? current.items.filter((item) => item.id !== notification.id)
                : current.items.map((item) =>
                    item.id === notification.id
                      ? { ...item, isRead: true, readAt: new Date().toISOString() }
                      : item,
                  ),
            }
          : current,
      );
      window.dispatchEvent(new Event('aicte:refresh'));
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await api.post('/notifications/read-all');
      toast.success('All notifications marked as read.');
      refreshEverything();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = list.data?.unreadCount ?? 0;
  const items = list.data?.items ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="Insights"
        title="Notifications"
        subtitle="Case assignments, SLA warnings, coordination alerts and identity reviews addressed to you. Notifications are deduplicated per recipient and refresh from the server."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refreshEverything} loading={list.loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={markAllRead}
              loading={markingAll}
              disabled={unreadCount === 0}
            >
              <CheckCheck className="h-4 w-4" /> Mark all read
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Unread"
          value={unreadCount}
          hint="Requires your attention"
          tone={unreadCount > 0 ? 'warning' : 'success'}
          icon={<Bell className="h-5 w-5" />}
        />
        <StatCard
          label="In this view"
          value={list.data?.total ?? '—'}
          hint={unreadOnly ? 'Unread notifications' : 'All notifications'}
          tone="info"
          icon={<Inbox className="h-5 w-5" />}
        />
        <StatCard
          label="Delivery"
          value="On refresh"
          hint="Server-backed, no privileged socket"
          icon={<RefreshCw className="h-5 w-5" />}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          variant={unreadOnly ? 'outline' : 'secondary'}
          size="sm"
          onClick={() => {
            setUnreadOnly(false);
            setPage(1);
          }}
        >
          All notifications
        </Button>
        <Button
          variant={unreadOnly ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => {
            setUnreadOnly(true);
            setPage(1);
          }}
        >
          Unread only{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </Button>
      </div>

      {list.error ? (
        <Card>
          <ErrorBlock message={list.error} onRetry={list.reload} />
        </Card>
      ) : list.loading && !list.data ? (
        <Card>
          <LoadingBlock label="Loading notifications…" />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
            message={
              unreadOnly
                ? 'You are up to date. Switch to all notifications to review earlier activity.'
                : 'Assignment, deadline and coordination messages will appear here when they apply to your role and scope.'
            }
            icon={<BellOff className="h-6 w-6" />}
            action={
              unreadOnly ? (
                <Button variant="outline" size="sm" onClick={() => setUnreadOnly(false)}>
                  Show all notifications
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {items.map((notification) => (
              <li
                key={notification.id}
                className={cn(
                  'flex flex-col gap-3 px-5 py-4 transition sm:flex-row sm:items-start',
                  notification.isRead ? 'bg-white' : 'bg-sky-50/60',
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    notification.isRead ? 'bg-slate-100 text-slate-500' : 'bg-sky-100 text-sky-700',
                  )}
                >
                  {typeIcon(notification.type)}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={typeTone(notification.type)}>
                      {TYPE_LABELS[notification.type] ?? titleize(notification.type)}
                    </Badge>
                    {!notification.isRead && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-sky-600" aria-hidden="true" />
                        Unread
                      </span>
                    )}
                    <span className="text-[11px] text-slate-400">{formatDateTime(notification.createdAt)}</span>
                  </div>

                  <p className={cn('mt-1.5 text-sm', notification.isRead ? 'font-medium text-slate-800' : 'font-semibold text-slate-900')}>
                    {notification.title}
                  </p>
                  <p className="mt-0.5 text-sm leading-6 text-slate-600">{notification.message}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {notification.link && (
                      <Link
                        to={notification.link}
                        onClick={() => void markRead(notification)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-800 hover:underline"
                      >
                        Open related record <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                    {!notification.isRead && (
                      <button
                        type="button"
                        onClick={() => void markRead(notification)}
                        disabled={busyId === notification.id}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-slate-800 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {busyId === notification.id ? 'Marking…' : 'Mark as read'}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={list.data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </Card>
      )}
    </div>
  );
}
