import { Navigate, Outlet } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { Role } from '../services/types';
import { Spinner } from './ui';

interface ProtectedRouteProps {
  /**
   * Optional role gate for client-side routing convenience. This is not an
   * authorization boundary: the API enforces the same roles server-side.
   */
  roles?: Role[];
}

export default function ProtectedRoute({ roles }: ProtectedRouteProps) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-card">
          <ShieldCheck className="h-6 w-6 text-accent-600" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-slate-900">AICTE GrievanceHub</p>
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Spinner className="h-3.5 w-3.5" /> Restoring your session…
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (roles?.length && (!user || !roles.includes(user.role))) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
