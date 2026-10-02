'use client';
import { useState } from 'react';

/**
 * Every KES amount typed into Lango: shows thousand separators as you type (15,000 not 15000) so an extra or
 * missing zero is easy to spot. The form receives plain digits under `name`.
 */
const group = (digits: string) => (digits ? Number(digits).toLocaleString('en-KE') : '');

export function MoneyInput({
  name,
  defaultValue,
  placeholder = 'Amount',
  className = '',
  required,
  label = 'Amount in KES',
  prefix = true,
}: {
  name: string;
  defaultValue?: number | string | null;
  placeholder?: string;
  className?: string;
  required?: boolean;
  label?: string;
  /** Show "KES" inside the field. */
  prefix?: boolean;
}) {
  const [digits, setDigits] = useState(String(defaultValue ?? '').replace(/\D/g, ''));
  return (
    <span
      className={`flex items-center overflow-hidden rounded-[10px] border border-[#E5E8EE] bg-white transition focus-within:border-[#047857] focus-within:ring-4 focus-within:ring-emerald-500/10 ${className}`}
    >
      {prefix && (
        <span className="flex h-full items-center self-stretch border-r border-[#EEF1F6] bg-slate-50 px-2.5 text-[12px] font-semibold text-ink-500">
          KES
        </span>
      )}
      <input
        aria-label={label}
        inputMode="numeric"
        autoComplete="off"
        required={required}
        value={group(digits)}
        placeholder={placeholder}
        onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9))}
        className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-[13px] tabular-nums text-ink-900 outline-none placeholder:text-slate-400"
      />
      <input type="hidden" name={name} value={digits} />
    </span>
  );
}
