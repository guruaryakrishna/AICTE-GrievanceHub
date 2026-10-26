import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button, Field, InlineAlert, Input } from '../components/ui';
import { getErrorMessage } from '../lib/format';

const demoAccounts = [
  { label: 'Administrator', email: 'admin@aicte-demo.gov.in', note: 'Full access, SLA & audit' },
  { label: 'RB Officer', email: 'rb.officer@aicte-demo.gov.in', note: 'Regulation Bureau scope' },
  { label: 'PGRC Officer', email: 'pgrc.officer@aicte-demo.gov.in', note: 'Grievance cell scope' },
  { label: 'Regional Officer', email: 'regional.officer@aicte-demo.gov.in', note: 'Northern Region' },
  { label: 'Senior Management', email: 'senior@aicte-demo.gov.in', note: 'Read-only oversight' },
  { label: 'Read-only Viewer', email: 'viewer@aicte-demo.gov.in', note: 'Read-only demo' },
];

export default function Login() {
  const { login, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@aicte-demo.gov.in');
  const [password, setPassword] = useState('Demo@123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!authLoading && isAuthenticated) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const fill = (accountEmail: string) => {
    setEmail(accountEmail);
    setPassword('Demo@123');
    setError('');
  };

  return (
    <div className="min-h-screen bg-navy-950 text-white">
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
        <section className="hidden lg:block">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-semibold text-accent-200">
            <ShieldCheck className="h-4 w-4" />
            AICTE GrievanceHub · demonstration environment
          </div>
          <h1 className="mt-6 max-w-xl text-4xl font-bold leading-tight tracking-tight">
            One accountable view of every institution grievance.
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-6 text-navy-200">
            Register complaints, verify institution identity, surface cross-Bureau overlaps, and enforce a single SLA
            policy across the Regulation Bureau and the Public Grievance Redressal Cell.
          </p>
          <dl className="mt-10 grid max-w-lg grid-cols-3 gap-3">
            {[
              ['Lifecycle', 'Server-enforced'],
              ['Identity', 'Human verified'],
              ['SLA', 'One policy'],
            ].map(([term, description]) => (
              <div key={term} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                <dt className="text-[11px] uppercase tracking-widest text-accent-300">{term}</dt>
                <dd className="mt-1 text-sm font-semibold text-white">{description}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 text-xs leading-5 text-navy-400">
            All records shown in this environment are synthetic and fictional. No live AICTE data is used.
          </p>
        </section>

        <section className="w-full">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-pop sm:p-8">
            <div className="flex items-center gap-3 lg:hidden">
              <div className="rounded-xl bg-accent-50 p-2 text-accent-700">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-bold">AICTE GrievanceHub</p>
                <p className="text-xs text-slate-500">Integrated monitoring command centre</p>
              </div>
            </div>

            <div className="mt-2 lg:mt-0">
              <h2 className="text-xl font-bold tracking-tight text-slate-900">Sign in to continue</h2>
              <p className="mt-1 text-sm text-slate-500">
                Use an authorised demonstration account. Sessions are secured with an HTTP-only cookie.
              </p>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              {error && <InlineAlert tone="danger">{error}</InlineAlert>}
              <Field label="Official email" htmlFor="email" required>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@aicte-demo.gov.in"
                />
              </Field>
              <Field label="Password" htmlFor="password" required>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Button type="submit" loading={loading} className="w-full" size="lg">
                <LockKeyhole className="h-4 w-4" />
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            <div className="mt-6 border-t border-slate-100 pt-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Demo accounts</p>
                <span className="text-[11px] text-slate-400">Password: Demo@123</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {demoAccounts.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => fill(account.email)}
                    className="group flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-accent-300 hover:bg-accent-50/40"
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-slate-800">{account.label}</span>
                      <span className="block truncate text-[11px] text-slate-500">{account.note}</span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:text-accent-600" />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-4 text-center text-[11px] leading-5 text-navy-300">
            Synthetic demonstration data only · Role-based access is enforced by the server
          </p>
        </section>
      </div>
    </div>
  );
}
