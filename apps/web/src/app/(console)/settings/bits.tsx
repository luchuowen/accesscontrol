export type Note = [tone: 'green' | 'amber' | 'red', text: string];

/** Title of a settings section (the page title stays "Settings" in the top bar). */
export function TabHead({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
        {sub && <p className="mt-0.5 max-w-2xl text-[13px] text-ink-500">{sub}</p>}
      </div>
      {actions}
    </div>
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
