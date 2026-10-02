'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

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
