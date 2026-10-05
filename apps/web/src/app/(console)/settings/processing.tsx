import { Loader2, Smartphone } from 'lucide-react';
import { kes } from '@/lib/format';

/** Shown in place of the pay form from the moment the prompt goes out until M-Pesa confirms it. */
export function Processing({
  amount,
  dark,
  wide,
  what = 'pay',
}: {
  amount: number;
  dark?: boolean;
  wide?: boolean;
  what?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`relative flex w-full items-start gap-3.5 rounded-2xl p-4 ring-1 ${wide ? '' : 'lg:w-[390px]'} ${dark ? 'bg-white/[0.06] text-white ring-white/10' : 'bg-white text-ink-900 ring-ink-100'}`}
    >
      <span
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${dark ? 'bg-white/10' : 'bg-emerald-50 text-emerald-700'}`}
      >
        <Smartphone size={20} />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          <Loader2 size={15} className="animate-spin" /> Processing your payment…
        </div>
        <p className={`mt-1 text-[12.5px] leading-relaxed ${dark ? 'text-white/70' : 'text-ink-500'}`}>
          Enter your M-Pesa PIN on your phone to {what} {kes(amount)}. This page updates by itself the moment the
          payment is confirmed; there is no need to pay again.
        </p>
      </div>
    </div>
  );
}
