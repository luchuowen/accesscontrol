import type { ChecklistItem } from '@lango/server';
import { CheckCircle2, Circle } from 'lucide-react';
import Link from 'next/link';

/** Club setup progress. Every tick is worked out from live data, so it can't drift from reality. */
const BY = { navac: 'NAVAC sets this up', installer: 'Your installer', club: '' } as const;

/**
 * In the club console, steps NAVAC or the installer do are shown with who does them and are not links; in the
 * partner console every step is shown plainly.
 */
export function Checklist({
  items,
  compact,
  audience = 'club',
}: {
  items: ChecklistItem[];
  compact?: boolean;
  audience?: 'club' | 'partner';
}) {
  const done = items.filter((i) => i.done).length;
  return (
    <section className="card p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="font-medium">Club setup</div>
          <div className="text-xs text-ink-500">
            {done === items.length ? 'Everything is in place.' : `${done} of ${items.length} done`}
          </div>
        </div>
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-ink-100">
          <div
            className="h-full rounded-full bg-brand-500"
            style={{ width: `${Math.round((done / items.length) * 100)}%` }}
          />
        </div>
      </div>
      <ul className={`mt-4 grid gap-2 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
        {items.map((i) => {
          const theirs = audience === 'club' && i.by !== 'club';
          const body = (
            <>
              {i.done ? (
                <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" />
              ) : (
                <Circle size={17} className="mt-0.5 shrink-0 text-ink-300" />
              )}
              <span className="min-w-0">
                <span className={i.done ? 'text-ink-700' : 'font-medium'}>{i.label}</span>
                <span className="block text-xs text-ink-500">{i.hint}</span>
                {theirs && !i.done && (
                  <span className="mt-1.5 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-ink-500">
                    {BY[i.by]}
                  </span>
                )}
              </span>
            </>
          );
          const cls = `flex items-start gap-2.5 rounded-xl p-3 text-sm ring-1 transition ${i.done ? 'ring-emerald-100 bg-emerald-50/40' : 'ring-ink-100'}`;
          return (
            <li key={i.key}>
              {theirs || audience === 'partner' ? (
                <div className={cls}>{body}</div>
              ) : (
                <Link href={i.href} className={`${cls} ${i.done ? '' : 'hover:ring-ink-300'}`}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
