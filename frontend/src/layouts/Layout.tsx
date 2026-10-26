import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  ChevronRight,
  CircleUserRound,
  FileText,
  Fingerprint,
  LayoutDashboard,
  LogOut,
  Menu,
  PlusCircle,
  ScrollText,
  ShieldCheck,
  Timer,
  Users,
  X,
} from 'lucide-react';
import { useAuth, isWritableRole } from '../contexts/AuthContext';
import api from '../services/api';
import { initials, roleLabel } from '../lib/format';
import { cn } from '../components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
  end?: boolean;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [pendingIdentity, setPendingIdentity] = useState(0);
  const [alertsToReview, setAlertsToReview] = useState(0);

  const canCreate = isWritableRole(user?.role);
  const isAdmin = user?.role === 'ADMIN';
  const canResolveIdentity = user?.role === 'ADMIN' || user?.role === 'REGIONAL_OFFICER';

  const loadBadges = useCallback(async () => {
    if (!user) return;
    const [notifications, identity, alerts] = await Promise.allSettled([
      api.get('/notifications/unread-count'),
      canResolveIdentity ? api.get('/institutions/identity/stats') : Promise.resolve(null),
      api.get('/alerts', { params: { status: 'NEW,UNDER_REVIEW,COORDINATION_REQUIRED', pageSize: 1 } }),
    ]);
    if (notifications.status === 'fulfilled') {
      setUnread(Number(notifications.value.data?.unreadCount ?? 0));
    }
    if (identity.status === 'fulfilled' && identity.value) {
      setPendingIdentity(Number(identity.value.data?.stats?.pending ?? 0));
    } else {
      setPendingIdentity(0);
    }
    if (alerts.status === 'fulfilled') {
      setAlertsToReview(Number(alerts.value.data?.total ?? 0));
    }
  }, [user, canResolveIdentity]);

  useEffect(() => {
    void loadBadges();
    const timer = window.setInterval(() => void loadBadges(), 30_000);
    const onRefresh = () => void loadBadges();
    window.addEventListener('aicte:refresh', onRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('aicte:refresh', onRefresh);
    };
  }, [loadBadges]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const operations: NavItem[] = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/cases', label: 'Cases', icon: FileText },
    ...(canCreate ? [{ to: '/cases/create', label: 'Register complaint', icon: PlusCircle }] : []),
    { to: '/institutions', label: 'Institutions', icon: Building2 },
    { to: '/identity', label: 'Identity queue', icon: Fingerprint, badge: pendingIdentity },
    { to: '/overlaps', label: 'Overlaps & duplicates', icon: AlertTriangle, badge: alertsToReview },
  ];

  const insights: NavItem[] = [
    { to: '/reports', label: 'Reports & analytics', icon: BarChart3 },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: unread },
  ];

  const administration: NavItem[] = isAdmin
    ? [
        { to: '/admin/users', label: 'Users & access', icon: Users },
        { to: '/admin/sla-rules', label: 'SLA policy', icon: Timer },
        { to: '/admin/audit', label: 'Audit trail', icon: ScrollText },
      ]
    : [];

  const renderGroup = (label: string, items: NavItem[]) => {
    if (items.length === 0) return null;
    return (
      <div className="px-3">
        <p className="px-3 pb-2 pt-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-navy-400">{label}</p>
        <nav className="space-y-1">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-white/10 text-white shadow-inner'
                      : 'text-navy-200 hover:bg-white/5 hover:text-white',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={cn('h-4.5 w-4.5 shrink-0', isActive ? 'text-accent-300' : 'text-navy-400')} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <span className="rounded-full bg-accent-500 px-1.5 py-0.5 text-[10px] font-bold text-navy-950">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-navy-600 opacity-0 transition group-hover:opacity-100" />
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-slate-900/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-navy-900 text-white transition-transform duration-200 lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <div className="rounded-xl bg-accent-500/15 p-2 ring-1 ring-accent-400/30">
            <ShieldCheck className="h-6 w-6 text-accent-300" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <Link to="/dashboard" className="block truncate text-sm font-bold tracking-tight text-white">
              AICTE GrievanceHub
            </Link>
            <p className="truncate text-[11px] text-navy-300">Integrated monitoring command centre</p>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="ml-auto rounded-md p-1 text-navy-300 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-4">
          {renderGroup('Operations', operations)}
          {renderGroup('Insights', insights)}
          {renderGroup('Administration', administration)}
        </div>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-500/20 text-xs font-bold text-accent-200 ring-1 ring-accent-400/30">
              {initials(user?.firstName, user?.lastName)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="truncate text-[11px] text-navy-300">{roleLabel(user?.role ?? '')}</p>
              {(user?.bureau || user?.region) && (
                <p className="truncate text-[10px] text-navy-400">{user.bureau?.name ?? user.region?.name}</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md p-1.5 text-navy-300 transition hover:bg-red-500/15 hover:text-red-200"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">
                Integrated Institution Complaint Monitoring &amp; Status Dashboard
              </p>
              <p className="hidden truncate text-xs text-slate-500 sm:block">
                AICTE · demonstration environment · synthetic data only
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 md:flex">
                <CircleUserRound className="h-3.5 w-3.5 text-slate-400" />
                {user?.role === 'BUREAU_OFFICER' ? user.bureau?.name : user?.role === 'REGIONAL_OFFICER' ? user.region?.name : 'All AICTE scope'}
              </div>
              <Link
                to="/notifications"
                className="relative rounded-lg p-2 text-slate-600 transition hover:bg-slate-100"
                aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
              >
                <Bell className="h-5 w-5" />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>
              <div className="hidden h-8 w-px bg-slate-200 sm:block" />
              <button
                type="button"
                onClick={handleLogout}
                className="hidden items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-red-50 hover:text-red-700 sm:flex"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
