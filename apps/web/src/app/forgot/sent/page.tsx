import Link from 'next/link';
import { AuthHeading, AuthShell } from '@/components/auth-shell';

export const metadata = { title: 'Check your email · Lango' };

/** The same answer whether or not the email has an account (nobody can probe which emails exist). */
export default async function Sent({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  return (
    <AuthShell>
      <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      </div>
      <AuthHeading
        title="Check your email"
        sub={
          invite
            ? 'If your invitation is still pending, we’ve sent you a new link. Check your inbox and follow the link to set up your account.'
            : 'If an account exists for this email, we’ve sent a password reset link. Check your inbox and follow the link to reset your password.'
        }
      />
      <p className="mt-4 text-sm text-slate-500">Didn’t get it? Check your spam folder.</p>
      <Link href="/login" className="auth-btn mt-8">
        Back to sign in
      </Link>
    </AuthShell>
  );
}
