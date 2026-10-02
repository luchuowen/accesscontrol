import { LangoMark } from '@/components/logo';
import { SubmitButton } from '@/components/submit-button';
import { login } from './actions';

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-ink-950 p-12 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5">
          <LangoMark size={36} />
          <span className="text-lg font-semibold tracking-tight">Lango</span>
        </div>
        <div className="mt-auto max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">Paid members walk straight in.</h2>
          <p className="mt-4 text-ink-300">
            Payments, memberships and access control in one place. The doors know who has paid — even when the internet
            doesn&apos;t.
          </p>
        </div>
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
      </div>
      <div className="flex items-center justify-center p-6">
        <form action={login} className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-ink-500">Use the email your club administrator registered.</p>
          {e && (
            <div className="mt-6 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">
              {e === '2' ? 'Too many attempts. Wait a few minutes and try again.' : 'Email or password is incorrect.'}
            </div>
          )}
          <label className="mt-6 block">
            <span className="label">Email</span>
            <input name="email" type="email" required autoComplete="email" className="input mt-1.5" />
          </label>
          <label className="mt-4 block">
            <span className="label">Password</span>
            <input name="password" type="password" required autoComplete="current-password" className="input mt-1.5" />
          </label>
          <SubmitButton pendingText="Signing in…" className="btn-primary mt-6 w-full">
            Sign in
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
