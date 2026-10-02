import Link from 'next/link';
import { AuthHeading, AuthShell } from '@/components/auth-shell';

export const metadata = { title: 'Check your email · Lango' };

/** The same answer whether or not the email has an account (nobody can probe which emails exist). */
export default async function Sent({ searchParams }: { searchParams: Promise<{ to?: string; invite?: string }> }) {
  const { to, invite } = await searchParams;
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
          invite ? (
            'If that invitation is still waiting to be accepted, a new link is on its way. The earlier link no longer works.'
          ) : (
            <>
              If <span className="font-medium text-ink-900">{to || 'that address'}</span> has a Lango account, a link to
              reset the password is on its way. It works once and expires in 30 minutes.
            </>
          )
        }
      />
      <ul className="mt-6 grid gap-2 text-sm text-slate-600">
        <li>• It comes from Lango &lt;lango@navac.co.ke&gt;.</li>
        <li>• Nothing after a few minutes? Check spam or promotions.</li>
        <li>• Still nothing? Email support@navac.co.ke.</li>
      </ul>
      <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
        <Link href="/login" className="auth-link">
          Back to sign in
        </Link>
        {!invite && (
          <Link href="/forgot" className="auth-link">
            Use a different email
          </Link>
        )}
      </div>
    </AuthShell>
  );
}
