import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { requirePartner } from '@/lib/session';
import { NewClubForm } from './form';

export default async function NewClub() {
  const s = await requirePartner();
  if (s.kind !== 'partner_admin') redirect('/partner');
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  return (
    <>
      <Link href="/partner" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900">
        <ArrowLeft size={15} /> Clubs
      </Link>
      <PageHeader
        title="Add a club"
        subtitle="Creates the club, invites its owner by email, and makes a pairing code for the Site Bridge. Payments, doors and members are set up from the club’s own console."
      />
      <NewClubForm consoleUrl={base} />
    </>
  );
}
