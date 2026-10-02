import { checkLink, type InviteContext, roleLabel } from '@lango/server';
import Link from 'next/link';
import { AuthHeading, AuthShell } from '@/components/auth-shell';
import { SubmitButton } from '@/components/submit-button';
import { db } from '@/server/db';
import { newInviteLink } from '../../login/actions';
import { AcceptForm } from './accept-form';

export const metadata = { title: 'Accept your invitation · Lango', referrer: 'no-referrer' };

const localPhone = (p: string | null) => (p?.startsWith('254') ? `0${p.slice(3)}` : (p ?? ''));

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const link = await checkLink(db(), 'invite', token);
  if (!link.ok) {
    const staff = 'staff' in link ? link.staff : null;
    const used = link.reason === 'used' || !!staff?.accepted_at;
    const invalid = link.reason === 'invalid';
    return (
      <AuthShell>
        <AuthHeading
          title={
            invalid ? 'This link isn’t valid' : used ? 'This invitation has been used' : 'This invitation has expired'
          }
          sub={
            invalid
              ? 'Open the newest invitation email and use its button. If it still fails, ask whoever invited you to send it again.'
              : used
                ? 'Your account is already set up. Sign in with your email and password.'
                : 'Invitation links work once and for 7 days. Ask for a fresh one and it will arrive in a moment.'
          }
        />
        <div className="mt-8 grid gap-3">
          {!used && staff ? (
            <form action={newInviteLink}>
              <input type="hidden" name="token" value={token} />
              <SubmitButton pendingText="Sending…" className="auth-btn">
                Send me a new link
              </SubmitButton>
            </form>
          ) : (
            <Link href="/login" className="auth-btn">
              Go to sign in
            </Link>
          )}
          {!used && staff && (
            <Link href="/login" className="auth-link text-center text-[13px]">
              Back to sign in
            </Link>
          )}
        </div>
      </AuthShell>
    );
  }
  const ctx = (link.data?.ctx ?? null) as InviteContext | null;
  const to = ctx?.to ?? 'Lango';
  const role = ctx?.roleLabel ?? roleLabel(link.staff.role);
  return (
    <AuthShell>
      <div className="text-[11px] font-semibold tracking-[0.14em] text-brand-600">INVITATION</div>
      <AuthHeading
        title={`Join ${to}`}
        sub={
          <>
            {ctx?.inviterName ?? 'Your administrator'} invited you as {/^[aeiou]/i.test(role) ? 'an' : 'a'}{' '}
            <span className="font-medium text-ink-900">{role}</span>. Set up your account to continue.
          </>
        }
      />
      <AcceptForm token={token} email={link.staff.email} name={link.staff.name} phone={localPhone(link.staff.phone)} />
    </AuthShell>
  );
}
