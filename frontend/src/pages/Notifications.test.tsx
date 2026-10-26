import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Notifications from './Notifications';
import { ToastProvider } from '../components/Toast';
import api from '../services/api';
import type { NotificationItem } from '../services/types';

vi.mock('../services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
  UNAUTHORIZED_EVENT: 'aicte:unauthorized',
}));

function notification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'notification-1',
    type: 'CASE_ASSIGNED',
    title: 'Case DEMO-COMP-2024-045 assigned to you',
    message: 'Review the complaint and record the next action.',
    link: '/cases/case-1',
    caseId: 'case-1',
    alertId: null,
    isRead: false,
    readAt: null,
    createdAt: '2026-10-25T09:30:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Notifications />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Notifications page', () => {
  it('loads notifications and marks a single item read', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { items: [notification()], total: 1, unreadCount: 1 },
    });
    vi.mocked(api.post).mockResolvedValueOnce({ data: { success: true } });

    renderPage();

    expect(await screen.findByText('Case DEMO-COMP-2024-045 assigned to you')).toBeInTheDocument();
    expect(screen.getAllByText('Unread').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Mark as read' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/notifications/notification-1/read'),
    );
    await waitFor(() => expect(screen.queryByText('Mark as read')).not.toBeInTheDocument());
  });

  it('marks all notifications read and refreshes the server view', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { items: [notification()], total: 1, unreadCount: 1 } })
      .mockResolvedValueOnce({
        data: { items: [notification({ isRead: true, readAt: '2026-10-25T10:00:00.000Z' })], total: 1, unreadCount: 0 },
      });
    vi.mocked(api.post).mockResolvedValueOnce({ data: { success: true } });

    renderPage();

    await screen.findByText('Case DEMO-COMP-2024-045 assigned to you');
    await user.click(screen.getByRole('button', { name: /Mark all read/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/notifications/read-all'));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('requests unread-only data when the filter is selected', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ data: { items: [], total: 0, unreadCount: 0 } });

    renderPage();

    await screen.findByText('No notifications yet');
    await user.click(screen.getByRole('button', { name: /Unread only/i }));

    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith('/notifications', {
        params: { page: 1, pageSize: 20, unreadOnly: 'true' },
      }),
    );
    expect(await screen.findByText('No unread notifications')).toBeInTheDocument();
  });

  it('surfaces a load failure with a retry action', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('network down'));

    renderPage();

    expect(await screen.findByText('Could not load this view')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
