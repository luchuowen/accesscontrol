'use client';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';

/** Re-reads the dashboard every 30 seconds while the tab is visible, so "In the club now" stays live. */
export function LiveRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

/** Re-reads the dashboard now. */
export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label="Refresh"
      onClick={() => start(() => router.refresh())}
      className="grid h-9 w-9 place-items-center rounded-[10px] border border-white/20 bg-white/[0.08] text-white transition hover:bg-white/15"
    >
      <RefreshCw size={15} className={pending ? 'animate-spin motion-reduce:animate-none' : ''} />
    </button>
  );
}
