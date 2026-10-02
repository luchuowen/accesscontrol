import { onboardingChecklist } from '@lango/server';
import { ArrowUpRight, CircleAlert, Wifi, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { Checklist } from '@/components/checklist';
import { Badge, Bars, PageHeader, Stat } from '@/components/ui';
import { dashboard } from '@/lib/data';
import { ago, dateTime, daysLeft, kes, kesShort, time } from '@/lib/format';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

export default async function Overview() {
  const s = await requireSession();
  const [d, checklist] = await Promise.all([dashboard(s.tid), onboardingChecklist(db(), s.tid)]);
  const setupDone = checklist.every((i) => i.done);
  const growth = d.revenue.prevMonth
    ? Math.round(((d.revenue.month - d.revenue.prevMonth) / d.revenue.prevMonth) * 100)
    : null;
  const online = d.bridge.lastSeen && Date.now() - d.bridge.lastSeen.getTime() < 120_000;
  const maxZone = Math.max(1, ...d.zoneVisits.map((z) => z.n));
  return (
    <>
      <PageHeader
        title={`Good ${new Date().getUTCHours() + 3 < 12 ? 'morning' : 'afternoon'}, ${s.name.split(' ')[0]}`}
        subtitle={`${d.tenantName} · everything that came in, and everyone who walked through the doors.`}
        actions={
          <Link href="/payments" className="btn-ghost">
            Reconciliation <ArrowUpRight size={15} />
          </Link>
        }
      />
      {!setupDone && (
        <div className="mb-4">
          <Checklist items={checklist} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Collected today" value={kes(d.revenue.today)} hint={`${kes(d.revenue.week)} in the last 7 days`} />
        <Stat
          label="Last 30 days"
          value={kes(d.revenue.month)}
          hint={
            growth === null ? (
              '—'
            ) : (
              <span className={growth >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                {growth >= 0 ? '▲' : '▼'} {Math.abs(growth)}% vs previous 30 days
              </span>
            )
          }
        />
        <Stat
          label="Active members"
          value={d.activeMembers}
          hint={`${d.newThisMonth} new · ${d.renewalsThisMonth} renewals this month`}
        />
        <Stat label="Visits today" value={d.visitsToday} hint="granted entries, all doors" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="card p-6 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="label">Daily collections</div>
              <div className="mt-1 text-sm text-ink-500">Last 30 days · M-Pesa, card and cash</div>
            </div>
            <div className="text-sm font-medium tabular-nums">{kes(d.daily.reduce((a, b) => a + b.amount, 0))}</div>
          </div>
          <div className="mt-6">
            <Bars
              data={d.daily.map((x) => ({ label: x.day.slice(5), value: x.amount }))}
              format={(n) => `KES ${kesShort(n)}`}
              height={170}
            />
          </div>
        </section>

        <section className="card flex flex-col p-6">
          <div className="label">Access system</div>
          <div className="mt-4 flex items-center gap-3">
            <div
              className={`grid h-10 w-10 place-items-center rounded-xl ${online ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}
            >
              {online ? <Wifi size={18} /> : <WifiOff size={18} />}
            </div>
            <div>
              <div className="font-medium">{online ? 'Site Bridge online' : 'Site Bridge offline'}</div>
              <div className="text-xs text-ink-500">Last contact {ago(d.bridge.lastSeen)}</div>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-ink-500">
            Doors keep working on their own while offline. Changes made in the meantime are delivered the moment the
            connection returns.
          </p>
          <div className="mt-auto grid grid-cols-2 gap-3 pt-6 text-sm">
            <div className="rounded-xl bg-ink-50 p-3">
              <div className="label">Waiting</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{d.bridge.pending}</div>
            </div>
            <div className={`rounded-xl p-3 ${d.bridge.failed ? 'bg-rose-50' : 'bg-ink-50'}`}>
              <div className="label">Needs attention</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{d.bridge.failed}</div>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="card p-6">
          <div className="label">Expiring in the next 7 days</div>
          <ul className="mt-4 divide-y divide-ink-100">
            {d.expiringSoon.length === 0 && (
              <li className="py-3 text-sm text-ink-500">Nobody — renewals are healthy.</li>
            )}
            {d.expiringSoon.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-3">
                <Link href={`/members/${m.id}`} className="text-sm font-medium hover:underline">
                  {m.name}
                  <span className="ml-2 font-mono text-[11px] text-ink-500">#{m.memberNo}</span>
                </Link>
                <Badge tone={(daysLeft(m.endsAt) ?? 0) <= 2 ? 'amber' : 'gray'}>{daysLeft(m.endsAt)} d</Badge>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-6">
          <div className="label">When members come in</div>
          <div className="mt-1 text-xs text-ink-500">Entries by hour, last 30 days</div>
          <div className="mt-5">
            <Bars
              data={d.hourly.map((v, h) => ({ label: `${String(h).padStart(2, '0')}:00`, value: v }))}
              height={110}
            />
            <div className="mt-2 flex justify-between font-mono text-[10px] text-ink-300">
              <span>00</span>
              <span>06</span>
              <span>12</span>
              <span>18</span>
              <span>23</span>
            </div>
          </div>
          <div className="mt-6 space-y-2.5">
            {d.zoneVisits.map((z) => (
              <div key={z.zone} className="flex items-center gap-3 text-sm">
                <div className="w-28 truncate text-ink-500">{z.zone}</div>
                <div className="h-2 flex-1 rounded-full bg-ink-50">
                  <div className="h-2 rounded-full bg-brand-500" style={{ width: `${(z.n / maxZone) * 100}%` }} />
                </div>
                <div className="w-10 text-right tabular-nums">{z.n}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-6">
          <div className="flex items-center justify-between">
            <div className="label">Live at the doors</div>
            <Link href="/access" className="text-xs text-ink-500 hover:text-ink-900">
              All activity →
            </Link>
          </div>
          <ul className="mt-4 space-y-3">
            {d.recent.map((r, i) => (
              <li key={`${r.at.getTime()}-${i}`} className="flex items-center gap-3 text-sm">
                <span className={`h-2 w-2 rounded-full ${r.granted ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                <span className="w-11 font-mono text-[11px] text-ink-500">{time(r.at)}</span>
                <span className="flex-1 truncate">{r.name ?? `Card ${r.memberNo ?? '?'}`}</span>
                <span className="text-xs text-ink-500">{r.zone ?? '—'}</span>
              </li>
            ))}
          </ul>
          {d.unmatched > 0 && (
            <Link
              href="/payments"
              className="mt-6 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200"
            >
              <CircleAlert size={15} /> {d.unmatched} payment{d.unmatched > 1 ? 's' : ''} could not be matched to a
              member and plan.
            </Link>
          )}
          <div className="mt-4 text-[11px] text-ink-300">Updated {dateTime(new Date())}</div>
        </section>
      </div>
    </>
  );
}
