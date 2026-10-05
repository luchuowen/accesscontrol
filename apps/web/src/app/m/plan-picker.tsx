'use client';
import { useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { memberPay } from './actions';

export interface PickPlan {
  id: string;
  title: string;
  note: string;
  price: number;
  mark: string;
}

const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`;

/** Wallet pass portal: plans as tappable rows and one bright pay button that names the amount. */
export function PlanPicker({ plans, initial }: { plans: PickPlan[]; initial: string | null }) {
  const [sel, setSel] = useState(initial ?? plans[0]?.id ?? '');
  const chosen = plans.find((p) => p.id === sel) ?? plans[0];
  if (!chosen) return null;
  return (
    <form action={memberPay} className="grid gap-2">
      <input type="hidden" name="productId" value={chosen.id} />
      {plans.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => setSel(p.id)}
          aria-pressed={p.id === chosen.id}
          className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition ${p.id === chosen.id ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' : 'border-[#E4E8EF] bg-white hover:bg-[#F7F9FC]'}`}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-emerald-100 text-[13px] font-bold text-emerald-700">
            {p.mark}
          </span>
          <span className="min-w-0 flex-1">
            <b className="block truncate text-[14px] font-semibold text-ink-900">{p.title}</b>
            <span className="block text-[12px] text-ink-500">{p.note}</span>
          </span>
          <span className="shrink-0 text-[14px] font-bold tabular-nums text-ink-900">{kes(p.price)}</span>
        </button>
      ))}
      <SubmitButton
        pendingText="Sending to your phone…"
        className="mt-1.5 h-[52px] w-full rounded-2xl bg-emerald-600 text-[15px] font-bold text-white shadow-[0_12px_24px_-12px_rgba(5,150,105,0.7)] transition hover:bg-emerald-700"
      >
        Pay {kes(chosen.price)} with M-Pesa
      </SubmitButton>
    </form>
  );
}
