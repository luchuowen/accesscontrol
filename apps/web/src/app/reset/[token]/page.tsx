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
          title={link.reason === 'used' ? 'This link has been used' : 'This link has expired'}
          sub="Reset links work once and only for 30 minutes, to keep your account safe. Ask for a new one; it takes a moment."
        />
        <div className="mt-8 grid gap-3">
          <Link href="/forgot" className="auth-btn">
            Send me a new link
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
        title="Choose a new password"
        sub={
          <>
            For <span className="font-medium text-ink-900">{link.staff.email}</span>. You’ll be signed out everywhere
            else, and then sign in with the new password.
          </>
        }
      />
      <ResetForm token={decodeURIComponent(token)} email={link.staff.email} />
    </AuthShell>
  );
}
