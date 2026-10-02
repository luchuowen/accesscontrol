import { Check } from 'lucide-react';
import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';

export const metadata = { title: 'Check your email · Lango' };

/** The same answer whether or not the email has an account (nobody can probe which emails exist). */
export default async function Sent({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  return (
    <AuthShell>
      <h1 className="text-center text-[26px] font-semibold tracking-tight text-ink-900">Check your email</h1>
      <div
        role="status"
        className="mt-6 flex flex-col items-center gap-3 rounded-[14px] border border-emerald-200 bg-emerald-50 px-6 py-6 text-center"
      >
        <div className="grid h-[38px] w-[38px] place-items-center rounded-[10px] bg-brand-500 text-white">
          <Check size={18} strokeWidth={2.4} aria-hidden="true" />
        </div>
        <div>
          <div className="text-[14.5px] font-semibold text-emerald-950">
            {invite ? 'New invitation sent' : 'Reset link sent'}
          </div>
          <p className="mt-1 text-[13.5px] leading-relaxed text-emerald-800">
            {invite
              ? 'If your invitation is still pending, we’ve sent you a new link. Check your inbox and follow the link to set up your account.'
              : 'If an account exists for this email, we’ve sent a password reset link. Check your inbox and follow the link to reset your password.'}
          </p>
        </div>
      </div>
      <p className="mt-4 text-center text-[13px] text-slate-500">
        Didn’t get it? Check your spam folder
        {invite ? (
          '.'
        ) : (
          <>
            {' '}
            or{' '}
            <Link href="/forgot" className="auth-link">
              send it again
            </Link>
            .
          </>
        )}
      </p>
      <Link href="/login" className="auth-btn mt-6">
        Back to sign in
      </Link>
    </AuthShell>
  );
}
