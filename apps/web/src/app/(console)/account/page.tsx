import { requireSession } from '@/lib/session';
import { AccountView } from './view';

export const metadata = { title: 'Your account · Lango' };

export default async function Account({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await requireSession();
  const { m } = await searchParams;
  return <AccountView s={s} m={m} from="club" />;
}
