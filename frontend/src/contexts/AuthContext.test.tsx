import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, canManageInstitutions, isWritableRole, useAuth } from './AuthContext';
import api from '../services/api';
import type { User } from '../services/types';

vi.mock('../services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
  UNAUTHORIZED_EVENT: 'aicte:unauthorized',
}));

const officer: User = {
  id: 'user-1',
  email: 'officer@aicte-demo.gov.in',
  firstName: 'Asha',
  lastName: 'Rao',
  role: 'BUREAU_OFFICER',
  bureauId: 'bureau-1',
  regionId: null,
};

function Probe() {
  const { user, loading, isAuthenticated, hasRole, login, logout } = useAuth();
  return (
    <div>
      <p data-testid="loading">{loading ? 'loading' : 'ready'}</p>
      <p data-testid="user">{user ? `${user.firstName} ${user.lastName}` : 'anonymous'}</p>
      <p data-testid="authenticated">{isAuthenticated ? 'yes' : 'no'}</p>
      <p data-testid="admin">{hasRole('ADMIN') ? 'admin' : 'not-admin'}</p>
      <p data-testid="officer">{hasRole('BUREAU_OFFICER', 'REGIONAL_OFFICER') ? 'officer' : 'not-officer'}</p>
      <button type="button" onClick={() => void login('officer@aicte-demo.gov.in', 'Demo@123')}>
        Sign in
      </button>
      <button type="button" onClick={() => void logout()}>
        Sign out
      </button>
    </div>
  );
}

describe('AuthContext', () => {
  it('restores an existing session and exposes role helpers', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { user: officer } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByTestId('loading')).toHaveTextContent('ready');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('yes');
    expect(screen.getByTestId('admin')).toHaveTextContent('not-admin');
    expect(screen.getByTestId('officer')).toHaveTextContent('officer');
    expect(api.get).toHaveBeenCalledWith('/auth/me');
  });

  it('treats a failed session restore as signed out', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('401'));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText('anonymous')).toBeInTheDocument();
    expect(screen.getByTestId('authenticated')).toHaveTextContent('no');
  });

  it('signs in, then signs out', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockRejectedValueOnce(new Error('no session'));
    vi.mocked(api.post).mockResolvedValueOnce({ data: { user: officer } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await screen.findByText('anonymous');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/login', {
      email: officer.email,
      password: 'Demo@123',
    });

    vi.mocked(api.post).mockResolvedValueOnce({ data: {} });
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('anonymous')).toBeInTheDocument();
  });

  it('clears the session when the API reports unauthorized', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { user: officer } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    window.dispatchEvent(new Event('aicte:unauthorized'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('anonymous'));
  });

  it('classifies writable and institution-management roles', () => {
    expect(isWritableRole('ADMIN')).toBe(true);
    expect(isWritableRole('BUREAU_OFFICER')).toBe(true);
    expect(isWritableRole('REGIONAL_OFFICER')).toBe(true);
    expect(isWritableRole('SENIOR_MANAGEMENT')).toBe(false);
    expect(isWritableRole('READ_ONLY')).toBe(false);
    expect(isWritableRole(undefined)).toBe(false);
    expect(canManageInstitutions('ADMIN')).toBe(true);
    expect(canManageInstitutions('REGIONAL_OFFICER')).toBe(true);
    expect(canManageInstitutions('BUREAU_OFFICER')).toBe(false);
  });
});
