import type { ReactNode } from 'react';

export type Note = [tone: 'green' | 'amber' | 'red', text: string];
type Icon = React.ComponentType<{ size?: number; className?: string }>;

/** Section header in the settings panel (NAVAC CRM style): icon tile, title, one short line, optional action. */
export function SectionHead({
  icon: I,
  title,
  sub,
  action,
}: {
  icon: Icon;
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex items-start gap-4 border-b border-[#EEF1F6] pb-5">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
        <I size={21} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
        {sub && <p className="mt-0.5 text-[13px] text-ink-500">{sub}</p>}
      </div>
      {action && <div className="shrink-0 pt-1">{action}</div>}
    </header>
  );
}

/** Kept for the Team tab, which has its own layout. */
export function TabHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
        {sub && <p className="mt-0.5 max-w-2xl text-[13px] text-ink-500">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Small uppercase label above a group of rows. */
export function Group({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-2 flex items-center">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="divide-y divide-[#F0F2F6] overflow-hidden rounded-2xl border border-[#E7EBF3]">{children}</div>
    </section>
  );
}

/** One line in a group: icon, label, optional hint, and the value or control on the right. */
export function Row({
  icon: I,
  label,
  hint,
  children,
}: {
  icon?: Icon;
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[54px] items-center gap-3 px-4 py-2.5">
      {I && <I size={17} className="shrink-0 text-ink-300" />}
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] text-ink-900">{label}</div>
        {hint && <div className="text-[12px] text-ink-500">{hint}</div>}
      </div>
      {children !== undefined && <div className="shrink-0 text-right text-[13.5px] font-semibold">{children}</div>}
    </div>
  );
}

/** An on/off switch that is still a normal form checkbox. */
export function Switch({ name, on, label }: { name: string; on: boolean; label: string }) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input type="checkbox" name={name} defaultChecked={on} aria-label={label} className="peer sr-only" />
      <span className="h-6 w-10 rounded-full bg-slate-200 transition peer-checked:bg-emerald-500 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-300" />
      <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
    </label>
  );
}

export function Pill({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  const tone =
    ok === null
      ? 'bg-slate-100 text-ink-500'
      : ok
        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
        : 'bg-amber-50 text-amber-800 ring-amber-200';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ring-transparent ${tone}`}
    >
      {children}
    </span>
  );
}

export function Banner({ note }: { note?: Note }) {
  if (!note) return null;
  const tone =
    note[0] === 'green'
      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
      : note[0] === 'red'
        ? 'bg-rose-50 text-rose-800 ring-rose-200'
        : 'bg-amber-50 text-amber-900 ring-amber-200';
  return <div className={`mb-5 rounded-xl p-3 text-sm ring-1 ${tone}`}>{note[1]}</div>;
}
