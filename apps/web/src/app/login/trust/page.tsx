import { deviceDays } from '@lango/server';
import { ShieldCheck } from 'lucide-react';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { SubmitButton } from '@/components/submit-button';
import { getSession } from '@/lib/session';
import { trustBrowser } from '../actions';

export const metadata = { title: 'Trust this browser? · Lango' };

export default async function Trust({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const s = await getSession();
  if (!s) redirect('/login?m=signed-out');
  const { next = '/' } = await searchParams;
  const days = deviceDays(s.kind);
  return (
    <AuthShell>
      <div className="text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700">
          <ShieldCheck size={26} aria-hidden="true" />
        </div>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink-900">Trust this browser?</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-500">
          If you trust it, you won’t be asked for a code when you sign in on this browser for the next {days} days. Only
          do this on a device you use yourself.
        </p>
      </div>
      <div className="mt-8 grid gap-3">
        <form action={trustBrowser}>
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="trust" value="yes" />
          <SubmitButton pendingText="Saving…" className="auth-btn">
            Trust
          </SubmitButton>
        </form>
        <form action={trustBrowser}>
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="trust" value="no" />
          <SubmitButton
            pendingText="Continuing…"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-slate-200 bg-white text-sm font-semibold text-ink-900 transition hover:bg-slate-50"
          >
            Don’t trust
          </SubmitButton>
        </form>
      </div>
    </AuthShell>
  );
}
