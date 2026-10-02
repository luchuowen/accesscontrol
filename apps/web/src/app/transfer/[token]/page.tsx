import { ownershipOffer } from '@lango/server';
import Link from 'next/link';
import { AuthHeading, AuthNotice, AuthShell } from '@/components/auth-shell';
import { SubmitButton } from '@/components/submit-button';
import { getSession } from '@/lib/session';
import { db } from '@/server/db';
import { takeClub } from '../../(console)/team/actions';

export const metadata = { title: 'Accept ownership · Lango', referrer: 'no-referrer' };

/** The admin confirms taking over a club. Must be signed in as the person the offer was sent to. */
export default async function Transfer({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  const token = decodeURIComponent((await params).token);
  const { e } = await searchParams;
  const offer = await ownershipOffer(db(), token);
  const s = await getSession();
  if (!offer.ok)
    return (
      <AuthShell>
        <AuthHeading
          title={offer.reason === 'used' ? 'This offer has been used' : 'This offer is no longer valid'}
          sub="Ownership offers work once and for 7 days. Ask the owner to offer it again if needed."
        />
        <Link href="/" className="auth-btn mt-8">
          Go to Lango
        </Link>
      </AuthShell>
    );
  const mine = s?.uid === offer.staff.id;
  return (
    <AuthShell>
      <div className="text-[11px] font-semibold tracking-[0.14em] text-brand-600">OWNERSHIP</div>
      <AuthHeading
        title={`Become the owner of ${offer.club}`}
        sub={`${offer.fromName} would like to hand ${offer.club} to you. As owner you hold the club’s subscription and contract, and you are the only person who can close the club or hand it on. ${offer.fromName} stays on as an admin.`}
      />
      {e && (
        <AuthNotice tone="error">The handover could not be completed. The offer may have been replaced.</AuthNotice>
      )}
      {mine ? (
        <form action={takeClub} className="mt-8 grid gap-3">
          <input type="hidden" name="token" value={token} />
          <SubmitButton pendingText="Accepting…" className="auth-btn">
            Accept ownership
          </SubmitButton>
          <Link href="/" className="text-center text-[13px] text-slate-500 hover:text-ink-900">
            Not now
          </Link>
        </form>
      ) : (
        <>
          <AuthNotice tone="info">
            Sign in as {offer.staff.email} first, then open the link in the email again.
          </AuthNotice>
          <Link href="/login" className="auth-btn mt-6">
            Sign in
          </Link>
        </>
      )}
    </AuthShell>
  );
}
