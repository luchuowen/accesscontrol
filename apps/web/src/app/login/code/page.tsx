import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthHeading, AuthNotice, AuthShell } from '@/components/auth-shell';
import { SubmitButton } from '@/components/submit-button';
import { getPending } from '@/lib/session';
import { resendCode, verifyCode } from '../actions';

export const metadata = { title: 'Sign-in code · Lango' };

const ERRORS: Record<string, string> = {
  '1': 'That code is not right, or it has expired. Check the latest message, or send a new code.',
  '2': 'Too many attempts. Wait a few minutes and try again.',
  '3': 'We could not send a code that way. Try the other option.',
};

export default async function Code({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; w?: string; r?: string }>;
}) {
  const { e, w, r } = await searchParams;
  const p = await getPending();
  if (!p) redirect('/login?m=expired');
  const other = p.channel === 'email' ? 'sms' : 'email';
  return (
    <AuthShell>
      <AuthHeading
        title={p.channel === 'email' ? 'Check your email' : 'Check your phone'}
        sub={
          p.challengeId ? (
            <>
              We sent a 6-digit code {p.channel === 'email' ? 'by email to' : 'by SMS to'}{' '}
              <span className="font-medium text-ink-900">{p.masked}</span>. It expires in 10 minutes.
            </>
          ) : (
            'A code was sent a moment ago. Wait a minute before asking for another.'
          )
        }
      />
      {e && ERRORS[e] && <AuthNotice tone="error">{ERRORS[e]}</AuthNotice>}
      {!e && w && <AuthNotice tone="info">Please wait a minute before asking for another code.</AuthNotice>}
      {!e && !w && r && <AuthNotice tone="ok">A new code is on its way.</AuthNotice>}
      <form action={verifyCode} className="mt-8 grid gap-[18px]">
        <div>
          <label htmlFor="code" className="auth-label">
            Sign-in code
          </label>
          <input
            id="code"
            name="code"
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            placeholder="Enter 6-digit code"
            className="auth-input text-center font-mono text-lg tracking-[0.4em] placeholder:font-sans placeholder:text-sm placeholder:tracking-normal"
          />
        </div>
        <label className="flex items-center gap-2.5 text-sm text-slate-600">
          <input type="checkbox" name="remember" className="h-4 w-4 rounded border-slate-300 accent-[#10B981]" />
          Remember this device (skip the code next time)
        </label>
        <SubmitButton pendingText="Checking…" className="auth-btn">
          Continue
        </SubmitButton>
      </form>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[12.5px] text-slate-500">
        <form action={resendCode}>
          <input type="hidden" name="via" value={p.channel ?? 'sms'} />
          <button type="submit" className="auth-link">
            Send a new code
          </button>
        </form>
        <form action={resendCode}>
          <input type="hidden" name="via" value={other} />
          <button type="submit" className="auth-link">
            {other === 'email' ? 'Email me the code instead' : 'Text me the code instead'}
          </button>
        </form>
        <Link href="/login" className="hover:text-ink-900">
          Use another account
        </Link>
      </div>
    </AuthShell>
  );
}
