import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthHeading, AuthNotice, AuthShell } from '@/components/auth-shell';
import { PasswordField } from '@/components/password-field';
import { SubmitButton } from '@/components/submit-button';
import { getSession } from '@/lib/session';
import { login } from './actions';

export const metadata = { title: 'Sign in · Lango' };

const ERRORS: Record<string, string> = {
  '1': 'That email and password don’t match an active account.',
  '2': 'Too many attempts. Wait 15 minutes and try again, or reset your password.',
};
const NOTES: Record<string, [tone: 'ok' | 'info', text: string]> = {
  'signed-out-ok': ['ok', 'You’re signed out.'],
  'signed-out': ['info', 'Your session ended. Sign in again to continue.'],
  expired: ['info', 'That sign-in took too long. Start again.'],
  reset: ['ok', 'Your password has been changed. Sign in with the new one.'],
};

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string; m?: string }> }) {
  const { e, m } = await searchParams;
  const s = await getSession();
  if (s) redirect(s.partner && !s.tid ? '/partner' : '/');
  const note = m ? NOTES[m] : undefined;
  return (
    <AuthShell>
      <AuthHeading title="Welcome back" sub="Sign in to your Lango account" />
      {e && ERRORS[e] && <AuthNotice tone="error">{ERRORS[e]}</AuthNotice>}
      {!e && note && <AuthNotice tone={note[0]}>{note[1]}</AuthNotice>}
      <form action={login} className="mt-8 grid gap-[18px]">
        <div>
          <label htmlFor="email" className="auth-label">
            Work email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username"
            inputMode="email"
            placeholder="you@yourclub.co.ke"
            className="auth-input"
          />
        </div>
        <div>
          <div className="auth-label">
            <label htmlFor="password">Password</label>
            <Link href="/forgot" className="auth-link">
              Forgot password?
            </Link>
          </div>
          <PasswordField name="password" autoComplete="current-password" />
        </div>
        <SubmitButton pendingText="Signing in…" className="auth-btn mt-1">
          Sign in
        </SubmitButton>
        <p className="text-center text-[12.5px] text-slate-500">
          New to Lango? Your club or partner sends you an invitation.
        </p>
      </form>
    </AuthShell>
  );
}
