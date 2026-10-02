import { requirePartner } from '@/lib/session';
import { AccountView } from '../../(console)/account/view';

export const metadata = { title: 'Your account · Lango' };

export default async function PartnerAccount({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await requirePartner();
  const { m } = await searchParams;
  return <AccountView s={s} m={m} from="partner" />;
}
