import { withTenant } from '@lango/db';
import { can, inventorySummary, planImport } from '@lango/server';
import { DoorOpen, Download, RefreshCw, Server, ShieldCheck, UserPlus } from 'lucide-react';
import { headers } from 'next/headers';
import { CopyField } from '@/components/copy-field';
import { Notice } from '@/components/notice';
import { SubmitButton } from '@/components/submit-button';
import { Badge, PageHeader, Stat } from '@/components/ui';
import { accessOverview } from '@/lib/data';
import { ago, dateTime } from '@/lib/format';
import { requirePerm } from '@/lib/session';
import { db } from '@/server/db';
import { importFromAxtrax, reissuePairCode, requestInventory, saveZone } from '../actions';

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

export default async function Access({
  searchParams,
}: {
  searchParams: Promise<{ n?: string; imported?: string; withAccess?: string; existing?: string; skipped?: string }>;
}) {
  const s = await requirePerm('doors.manage');
  const sp = await searchParams;
  const d = await accessOverview(s.tid);
  const base = (process.env.PUBLIC_URL ?? `https://${(await headers()).get('host')}`).replace(/\/$/, '');
  const install = `irm ${base}/bridge/install.ps1 | iex`;
  const manage = can(s, 'doors.manage');
  const sites = await withTenant(db(), s.tid, async (tx) => {
    const [t] = await tx<{ timezone: string }[]>`select timezone from tenants where id = ${s.tid}`;
    return Promise.all(
      d.sites.map(async (site) => {
        const inv = await inventorySummary(tx, site.id);
        const defaults = inv ? inv.groups.filter((g) => !g.staff && g.users > 0).map((g) => g.id) : [];
        const preview = inv ? await planImport(tx, site.id, t?.timezone ?? 'Africa/Nairobi', 14, defaults) : null;
        return { site, inv, defaults, preview };
      }),
    );
  });
  return (
    <>
      <Notice code={sp.n} />
      {sp.imported && (
        <div className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
          Imported {sp.imported} member(s) from AxTraxNG; {sp.withAccess} keep their current access. {sp.existing} were
          already in Lango{Number(sp.skipped) ? `, ${sp.skipped} skipped` : ''}. The Site Bridge takes them over within
          a minute.
        </div>
      )}
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
      {sites.map(({ site, inv, defaults, preview }) => {
        const b = d.bridges.find((x) => x.site_id === site.id);
        const online = b?.last_seen_at && Date.now() - b.last_seen_at.getTime() < 120_000;
        const zones = d.zones.filter((z) => z.site_id === site.id);
        const readerName = new Map((inv?.readers ?? []).map((r) => [r.id, r.door ? `${r.name} · ${r.door}` : r.name]));
        return (
          <div key={site.id} className="mt-6 grid gap-4 lg:grid-cols-3">
            <section className="card p-6">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
                  <Server size={18} />
                </div>
                <div className="flex-1">
                  <div className="font-medium">{site.name}</div>
                  <div className="text-xs text-ink-500">
                    AxTraxNG · Site Bridge {online ? 'online' : b?.last_seen_at ? 'offline' : 'not installed'} ·{' '}
                    {ago(b?.last_seen_at ?? null)}
                  </div>
                </div>
                <Badge tone={online ? 'green' : 'amber'}>{online ? 'online' : 'offline'}</Badge>
              </div>
              {b?.pair_code && (
                <div className="mt-5 space-y-3">
                  <div>
                    <span className="label">Pairing code</span>
                    <div className="mt-1.5">
                      <CopyField value={b.pair_code} label="Pairing code" />
                    </div>
                  </div>
                  <div>
                    <span className="label">Install on the AxTraxNG server PC</span>
                    <div className="mt-1.5">
                      <CopyField value={install} label="Install command" />
                    </div>
                    <p className="mt-1.5 text-xs text-ink-500">
                      Open PowerShell as Administrator, paste, and answer three questions: the pairing code and the
                      AxTraxNG operator login. That login stays on the PC.
                    </p>
                  </div>
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                {b?.last_seen_at && (
                  <form action={requestInventory}>
                    <input type="hidden" name="siteId" value={site.id} />
                    <SubmitButton pendingText="Asking…" className="btn-ghost px-3 py-2 text-xs">
                      <RefreshCw size={14} /> Read AxTraxNG again
                    </SubmitButton>
                  </form>
                )}
                {manage && b?.last_seen_at && (
                  <form action={reissuePairCode}>
                    <SubmitButton pendingText="Issuing…" className="btn-ghost px-3 py-2 text-xs">
                      <Download size={14} /> New PC? New pairing code
                    </SubmitButton>
                  </form>
                )}
              </div>
              {inv && (
                <p className="mt-4 text-xs text-ink-500">
                  AxTraxNG read {ago(inv.receivedAt)}: {inv.readers.length} readers, {inv.groups.length} access groups,{' '}
                  {inv.users} users.
                </p>
              )}
            </section>

            <section className="card p-6 lg:col-span-2">
              <div className="label">Zones → readers</div>
              <p className="mt-1 text-sm text-ink-500">
                A zone is what a plan sells (gym, pool, golf). Tick the AxTraxNG readers each zone opens.
              </p>
              <ul className="mt-4 space-y-3">
                {zones.map((z) => (
                  <li key={z.id} className="rounded-xl p-3 ring-1 ring-ink-100">
                    <form action={saveZone} className="space-y-2">
                      <input type="hidden" name="zoneId" value={z.id} />
                      <input type="hidden" name="siteId" value={site.id} />
                      <div className="flex items-center gap-2">
                        <DoorOpen size={15} className="text-ink-300" />
                        <input
                          name="name"
                          defaultValue={z.name}
                          disabled={!manage}
                          className="input max-w-xs py-1.5 font-medium"
                        />
                        <span className="font-mono text-[11px] text-ink-500">{z.key}</span>
                      </div>
                      {inv ? (
                        <div className="flex flex-wrap gap-2">
                          {inv.readers.map((r) => (
                            <label
                              key={r.id}
                              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ring-1 ring-ink-100"
                            >
                              <input
                                type="checkbox"
                                name="readers"
                                value={r.id}
                                disabled={!manage}
                                defaultChecked={z.reader_ids.includes(r.id)}
                                className="h-3.5 w-3.5 accent-ink-900"
                              />
                              {readerName.get(r.id)}
                            </label>
                          ))}
                          {inv.readers.length === 0 && (
                            <span className="text-xs text-ink-500">AxTraxNG has no readers yet (no panels added).</span>
                          )}
                        </div>
                      ) : (
                        <input
                          name="readerIds"
                          disabled={!manage}
                          defaultValue={z.reader_ids.join(', ')}
                          placeholder="Reader IDs, e.g. 11, 12 (picked from a list once the bridge is installed)"
                          className="input py-1.5 text-xs"
                        />
                      )}
                      {manage && (
                        <SubmitButton pendingText="Saving…" className="btn-ghost px-3 py-1.5 text-xs">
                          Save
                        </SubmitButton>
                      )}
                    </form>
                  </li>
                ))}
              </ul>
              {manage && (
                <form action={saveZone} className="mt-4 flex gap-2">
                  <input type="hidden" name="siteId" value={site.id} />
                  <input name="name" required placeholder="New zone, e.g. Golf course" className="input py-2" />
                  <SubmitButton pendingText="Adding…" className="btn-ghost py-2">
                    Add zone
                  </SubmitButton>
                </form>
              )}
            </section>

            {inv && preview && manage && (
              <section className="card p-6 lg:col-span-3">
                <div className="flex items-center gap-2">
                  <UserPlus size={18} />
                  <div className="font-medium">Bring in members already on AxTraxNG</div>
                </div>
                <p className="mt-1 text-sm text-ink-500">
                  Existing users become Lango members with their cards, and keep the access they have today: an end date
                  already set in AxTraxNG is kept; users without one get a grace period to pay. Staff groups stay
                  outside Lango and are never touched.
                </p>
                <form action={importFromAxtrax} className="mt-4 space-y-4">
                  <input type="hidden" name="siteId" value={site.id} />
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {inv.groups.map((g) => (
                      <label
                        key={g.id}
                        className="flex items-center gap-2.5 rounded-xl p-3 text-sm ring-1 ring-ink-100"
                      >
                        <input
                          type="checkbox"
                          name="groups"
                          value={g.id}
                          defaultChecked={defaults.includes(g.id)}
                          className="h-4 w-4 accent-ink-900"
                        />
                        <span className="flex-1">
                          {g.name}
                          {g.staff && <span className="ml-1.5 text-[11px] text-amber-700">staff · not imported</span>}
                        </span>
                        <span className="text-xs tabular-nums text-ink-500">{g.users}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      Grace period for users without an end date
                      <input
                        name="graceDays"
                        type="number"
                        min={0}
                        max={90}
                        defaultValue={14}
                        className="input w-20 py-1.5"
                      />
                      days
                    </label>
                    <span className="text-xs text-ink-500">
                      With the groups ticked above: {preview.create.length} new member(s),{' '}
                      {preview.create.filter((c) => c.until).length} with access today, {preview.existing} already in
                      Lango.
                    </span>
                  </div>
                  <SubmitButton pendingText="Importing…" className="btn-primary">
                    Import members
                  </SubmitButton>
                </form>
              </section>
            )}
          </div>
        );
      })}
      <section className="card mt-6 p-6">
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
        {d.events.length === 0 && <p className="mt-3 text-sm text-ink-500">No door activity yet.</p>}
      </section>
    </>
  );
}
