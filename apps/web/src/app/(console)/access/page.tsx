import { DoorOpen, Server, ShieldCheck } from 'lucide-react';
import { Badge, PageHeader, Stat } from '@/components/ui';
import { accessOverview } from '@/lib/data';
import { ago, dateTime } from '@/lib/format';
import { requireSession } from '@/lib/session';

/** "stop 2027-12-31T23:59:59 -> 2026-09-04T23:59:59" → what the person in AxTraxNG had set. */
function describe(change: string): string {
  const m = /^(start|stop|group) (.+?) (?:->|→) (.+)$/.exec(change);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const when = (v: string) => {
    const d = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(v); // naive club-local time from AxTraxNG
    return d ? `${Number(d[3])} ${MONTHS[Number(d[2]) - 1]} ${d[1]}, ${d[4]}` : 'no date';
  };
  if (!m) return change === 'bValidDate' ? 'Date checking switched off' : `${change} changed`;
  if (m[1] === 'stop') return `Valid until set to ${when(m[2] as string)}`;
  if (m[1] === 'start') return `Valid from set to ${when(m[2] as string)}`;
  return 'Door group changed';
}

export default async function Access() {
  const s = await requireSession();
  const d = await accessOverview(s.tid);
  return (
    <>
      <PageHeader
        title="Doors & access"
        subtitle="Your existing access-control system, connected. Doors decide on their own; Lango keeps them told who has paid."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Members on doors" value={d.stats?.total ?? 0} />
        <Stat label="In sync" value={d.stats?.synced ?? 0} />
        <Stat label="Waiting" value={(d.stats?.total ?? 0) - (d.stats?.synced ?? 0)} />
        <Stat label="Errors" value={d.stats?.failed ?? 0} tone={d.stats?.failed ? 'warn' : 'default'} />
      </div>
      {d.tamper.length > 0 && (
        <section className="card mt-6 p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-emerald-600" />
            <div className="font-medium">Hand edits in AxTraxNG, undone automatically</div>
          </div>
          <p className="mt-1 text-sm text-ink-500">
            Someone changed these members directly in the access-control software. Lango put back what they have paid
            for within minutes. Last 30 days.
          </p>
          <ul className="mt-4 divide-y divide-ink-100 text-sm">
            {d.tamper.map((t) => (
              <li
                key={`${t.at.getTime()}-${t.member_no}`}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5"
              >
                <span className="w-32 shrink-0 text-ink-500">{dateTime(t.at)}</span>
                <span className="font-medium">{t.name ?? `Member ${t.member_no}`}</span>
                <span className="text-ink-500">{t.changes.map(describe).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          {d.sites.map((site) => {
            const b = d.bridges.find((x) => x.site_id === site.id);
            const online = b?.last_seen_at && Date.now() - b.last_seen_at.getTime() < 120_000;
            return (
              <section key={site.id} className="card p-6">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
                    <Server size={18} />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">{site.name}</div>
                    <div className="text-xs text-ink-500">
                      AxTraxNG · Site Bridge {online ? 'online' : 'offline'} · {ago(b?.last_seen_at ?? null)}
                    </div>
                  </div>
                  <Badge tone={online ? 'green' : 'amber'}>{online ? 'online' : 'offline'}</Badge>
                </div>
                {b?.pair_code && !b.last_seen_at && (
                  <div className="mt-4 rounded-xl bg-ink-50 p-3 text-sm">
                    Pairing code for the Site Bridge installer:{' '}
                    <span className="font-mono font-semibold">{b.pair_code}</span>
                  </div>
                )}
                <div className="label mt-6">Zones → readers</div>
                <ul className="mt-3 space-y-2">
                  {d.zones
                    .filter((z) => z.site_id === site.id)
                    .map((z) => (
                      <li key={z.id} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <DoorOpen size={15} className="text-ink-300" />
                          {z.name}
                        </span>
                        <span className="font-mono text-xs text-ink-500">
                          {z.reader_ids.length ? z.reader_ids.join(', ') : 'not mapped'}
                        </span>
                      </li>
                    ))}
                </ul>
              </section>
            );
          })}
        </div>
        <section className="card p-6 lg:col-span-2">
          <div className="label">Door activity</div>
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-ink-100">
              {d.events.map((e, i) => (
                <tr key={`${e.at.getTime()}-${i}`}>
                  <td className="py-2.5 text-ink-500">{dateTime(e.at)}</td>
                  <td className="py-2.5">{e.name ?? `Card ${e.member_no ?? '?'}`}</td>
                  <td className="py-2.5 text-ink-500">{e.zone ?? `Reader ${e.reader_id}`}</td>
                  <td className="py-2.5 text-right">
                    {e.granted ? <Badge tone="green">granted</Badge> : <Badge tone="red">denied</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
