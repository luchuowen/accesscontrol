import { redirect } from 'next/navigation';

/** Team moved into Settings › Team & roles. */
export default async function Team({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  redirect(`/settings?tab=team${m ? `&m=${encodeURIComponent(m)}` : ''}`);
}
