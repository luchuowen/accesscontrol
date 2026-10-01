import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'good' | 'warn';
}) {
  const ring = tone === 'warn' ? 'ring-amber-200 bg-amber-50/60' : '';
  return (
    <div className={`card p-5 ${ring}`}>
      <div className="label">{label}</div>
      <div className="mt-2 text-[28px] font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
    </div>
  );
}

const tones = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  gray: 'bg-ink-50 text-ink-500 ring-ink-100',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
};
export function Badge({ tone = 'gray', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Bars({
  data,
  height = 140,
  format,
}: {
  data: { label: string; value: number }[];
  height?: number;
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="group relative flex-1">
          <div
            className="w-full rounded-t-[4px] bg-ink-900/85 transition group-hover:bg-brand-500"
            style={{ height: `${Math.max(2, (d.value / max) * (height - 8))}px` }}
          />
          <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-[11px] text-white group-hover:block">
            {d.label} · {format ? format(d.value) : d.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-100 p-8 text-center text-sm text-ink-500">
      {children}
    </div>
  );
}
