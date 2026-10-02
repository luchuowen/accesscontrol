import { codeResendAt } from '@lango/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthNotice, AuthShell } from '@/components/auth-shell';
import { getPending } from '@/lib/session';
import { db } from '@/server/db';
import { resendCode, verifyCode } from '../actions';
import { Checking, CodeTimer, OtpInput, ResendButton } from './otp';

export const metadata = { title: 'Sign-in code · Lango' };

const ERRORS: Record<string, string> = {
  '1': 'That code isn’t right or has expired. Check the latest message and try again.',
  '2': 'Too many attempts. Wait a few minutes and try again.',
  '3': 'We couldn’t send a code that way. Try the other option.',
};

/**
 * Design C (approved 2 Oct): countdown ring, six boxes, and the fallbacks in a help box. The form sends itself
 * when the sixth digit is in, so there is no Continue button.
 */
export default async function Code({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; w?: string; r?: string }>;
}) {
  const { e, w, r } = await searchParams;
  const p = await getPending();
  if (!p) redirect('/login?m=expired');
  const sms = p.channel !== 'email';
  const other = sms ? 'email' : 'sms';
  const next = await codeResendAt(db(), p.staffId);
  const minutes = Math.max(1, Math.ceil((next.at - Date.now()) / 60_000));
  return (
    <AuthShell>
      <div className="text-center">
        {p.expiresAt && <CodeTimer expiresAt={p.expiresAt} />}
        <h1 className="text-[26px] font-semibold tracking-tight text-ink-900">Enter your code</h1>
        <p className="mt-1.5 text-sm text-ink-500">
          {p.challengeId ? (
            <>
              Sent by {sms ? 'SMS' : 'email'} to <span className="font-medium text-ink-900">{p.masked}</span>
            </>
          ) : (
            'A code was sent a moment ago.'
          )}
        </p>
      </div>
      {e && ERRORS[e] && <AuthNotice tone="error">{ERRORS[e]}</AuthNotice>}
      {!e && r && <AuthNotice tone="ok">A new code is on its way.</AuthNotice>}
      {!e && !r && w && !next.capped && (
        <AuthNotice tone="info">Please wait before asking for another code.</AuthNotice>
      )}
      <form action={verifyCode}>
        <OtpInput />
        <Checking />
      </form>
      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-[13px] text-slate-600">
        {next.capped ? (
          <>
            You’ve asked for several codes. For your security, try again in about {minutes} minute
            {minutes === 1 ? '' : 's'}.
          </>
        ) : (
          <span className="inline-flex flex-wrap items-center justify-center gap-x-1.5">
            Didn’t get it?
            <form action={resendCode} className="inline">
              <input type="hidden" name="via" value={sms ? 'sms' : 'email'} />
              <ResendButton resendAt={next.at} label={sms ? 'Resend SMS' : 'Resend email'} />
            </form>
            <span aria-hidden="true">·</span>
            <form action={resendCode} className="inline">
              <input type="hidden" name="via" value={other} />
              <ResendButton resendAt={next.at} label={other === 'email' ? 'Email instead' : 'Text instead'} />
            </form>
          </span>
        )}
      </div>
      <p className="mt-3 text-center text-[13px]">
        <Link href="/login" className="text-slate-500 hover:text-ink-900">
          Use another account
        </Link>
      </p>
    </AuthShell>
  );
}
