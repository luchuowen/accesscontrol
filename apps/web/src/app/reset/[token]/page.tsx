import { checkLink } from '@lango/server';
import Link from 'next/link';
import { AuthHeading, AuthShell } from '@/components/auth-shell';
import { db } from '@/server/db';
import { ResetForm } from './reset-form';

export const metadata = { title: 'Choose a new password · Lango', referrer: 'no-referrer' };

export default async function Reset({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await checkLink(db(), 'reset', decodeURIComponent(token));
  if (!link.ok)
    return (
      <AuthShell>
        <AuthHeading
          title="This link has expired"
          sub="Password reset links can only be used once and expire after 30 minutes. Request a new link to continue."
        />
        <div className="mt-8 grid gap-3">
          <Link href="/forgot" className="auth-btn">
            Request a new link
          </Link>
          <Link href="/login" className="text-center text-[13px] auth-link">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  return (
    <AuthShell>
      <AuthHeading
        title="Reset your password"
        sub={
          <>
            Enter a new password for <span className="font-medium text-ink-900">{link.staff.email}</span>.
          </>
        }
      />
      <ResetForm token={decodeURIComponent(token)} email={link.staff.email} />
    </AuthShell>
  );
}
