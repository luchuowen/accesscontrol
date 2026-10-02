import { can } from '@lango/server';
import {
  CircleCheck,
  DoorOpen,
  Download,
  MonitorSmartphone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wrench,
} from 'lucide-react';
import { headers } from 'next/headers';
import Link from 'next/link';
import { CopyField } from '@/components/copy-field';
import { Notice } from '@/components/notice';
import { SubmitButton } from '@/components/submit-button';
import { PageHeader } from '@/components/ui';
import { type DoorEvent, doorsBoard } from '@/lib/data';
import { ago, kes } from '@/lib/format';
import { requirePerm } from '@/lib/session';
import { db } from '@/server/db';
import { reissuePairCode, requestInventory, saveZone } from '../actions';

/**
 * Doors & access, design A "Control room" (approved 2 Oct 2026). What it is for: are the doors letting in the right
 * people? Paid members get in, unpaid ones are stopped, and the owner hears when something breaks. Door PC health
 * and payments-on-doors at the top; today at the doors with everyone turned away (and why, with a way to ask them to
 * pay); what each area opens with "Add area"; changes made directly in the door software that Lango put back.
 * Pairing the door PC and linking readers to areas are the installer's (doors.setup); member import lives on Members.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A Tamper Guard record in plain words: "was given access until 31 Dec 2027", "had date checking switched off". */
function changed(changes: string[]): string {
  const parts: string[] = [];
  for (const c of changes) {
    const m = /^(start|stop|group) (.+?) (?:->|→) (.+)$/.exec(c);
    if (c === 'bValidDate') parts.push('had date checking switched off, so the card would open any time');
    else if (m?.[1] === 'stop') {
      const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(m[2] as string);
      const year = Number(d?.[1] ?? 0);
      parts.push(
        !d || year <= 2000
          ? 'had their access cut off'
          : `was given access until ${Number(d[3])} ${MONTHS[Number(d[2]) - 1]} ${year}`,
      );
    } else if (m?.[1] === 'group') parts.push('was moved to another door group');
    else if (m?.[1] === 'start')
      continue; // a start date alone tells the owner nothing
    else parts.push(`had their ${c.replace(/^b(?=[A-Z])/, '').toLowerCase()} changed`);
  }
  const uniq = [...new Set(parts)];
  return uniq.length ? uniq.join(', ') : 'had their door settings changed';
}

const hm = (d: Date) =>
  d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' });
const initials = (n: string) =>
  n
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

function EventRow({ e, canPay }: { e: DoorEvent; canPay: boolean }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-11 shrink-0 text-[12.5px] tabular-nums text-ink-500">{hm(e.at)}</span>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-[11.5px] font-semibold text-ink-700">
        {e.name ? initials(e.name) : '?'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold">
          {e.memberId ? (
            <Link href={`/members/${e.memberId}`} className="hover:underline">
              {e.name}
            </Link>
          ) : (
            `Card ${e.memberNo ?? '?'}`
          )}
        </div>
        <div className="truncate text-[12px] text-ink-500">
          {e.zone ?? `Reader ${e.readerId}`}
          {e.reason ? ` · ${e.reason}` : ''}
        </div>
      </div>
      {e.granted ? (
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-700">In</span>
      ) : (
        <>
          <span className="hidden rounded-full bg-rose-50 px-2 py-0.5 text-[11.5px] font-semibold text-rose-700 sm:inline">
            Turned away
          </span>
          {canPay && e.memberId && e.reason !== 'Wristband not paid for' && (
            <Link
              href={`/members/${e.memberId}#pay`}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] bg-[#047857] px-2.5 text-[12px] font-semibold text-white hover:bg-[#065F46]"
            >
              <Smartphone size={13} />
              {e.lastPriceKes ? `Prompt ${kes(e.lastPriceKes)}` : 'Ask to pay'}
            </Link>
          )}
        </>
      )}
    </li>
  );
}

export default async function Access({ searchParams }: { searchParams: Promise<{ n?: string; f?: string }> }) {
  const s = await requirePerm('doors.manage');
  const sp = await searchParams;
  const setup = can(s, 'doors.setup');
  const canPay = can(s, 'payments.record');
  const [d, [installer]] = await Promise.all([
    doorsBoard(s.tid),
    db()<{ name: string | null }[]>`
      select p.name from tenants t left join partners p on p.id = t.partner_id where t.id = ${s.tid}`,
  ]);
  const who = installer?.name ?? 'your installer';
  const lastSeen = d.bridges
    .map((b) => b.last_seen_at)
    .filter((x): x is Date => !!x)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const online = !!lastSeen && Date.now() - lastSeen.getTime() < 120_000;
  const waiting = d.stats.total - d.stats.synced;
  const away = d.events.filter((e) => !e.granted);
  const awayOnly = sp.f === 'away';
  const shown = awayOnly ? away : d.events.slice(0, 40);
  const site = d.sites[0];
  const base = (process.env.PUBLIC_URL ?? `https://${(await headers()).get('host')}`).replace(/\/$/, '');
  const card = 'rounded-2xl border border-[#E7EBF3] bg-white';
  const head = 'flex items-center gap-2.5 border-b border-[#EEF1F6] px-4 py-3';
  const tile = (label: string, value: React.ReactNode, sub: string, tone?: string) => (
    <div className={`${card} px-4 py-3.5`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{label}</div>
      <div className={`mt-1 flex items-center gap-2 text-[22px] font-semibold tracking-tight ${tone ?? ''}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[12px] text-ink-500">{sub}</div>
    </div>
  );

  return (
    <>
      <PageHeader title="Doors & access" subtitle="Who your doors let in, and anything that needs you." />
      <Notice code={sp.n} />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tile(
          'Door PC',
          <>
            <i className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {online ? 'Online' : lastSeen ? 'Offline' : 'Not connected'}
          </>,
          online
            ? `Checked in ${ago(lastSeen ?? null)}`
            : lastSeen
              ? `Last seen ${ago(lastSeen)}. Doors keep working; call ${who} if it lasts.`
              : `${who} connects it when installing.`,
        )}
        {tile(
          'On the doors',
          d.stats.failed ? `${d.stats.failed} failed` : waiting ? `${waiting} waiting` : `All ${d.stats.total}`,
          d.stats.failed
            ? `Couldn’t be written to the doors; ${who} has been alerted`
            : waiting
              ? online
                ? 'Payments on their way to the doors'
                : 'Reach the doors when the door PC is back'
              : 'Every payment has reached the doors',
          d.stats.failed ? 'text-rose-700' : waiting ? 'text-amber-700' : '',
        )}
        {tile('Entries today', <span className="tabular-nums">{d.today.entries}</span>, `${d.today.people} people`)}
        {tile(
          'Turned away today',
          <span className="tabular-nums">{d.today.denied}</span>,
          d.today.denied ? 'See who below and ask them to pay' : 'Nobody',
          d.today.denied ? 'text-rose-700' : '',
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <section className={`${card} overflow-hidden`}>
          <header className={head}>
            <h2 className="text-[14px] font-semibold">Today at the doors</h2>
            <nav className="ml-auto flex rounded-[10px] bg-slate-100 p-[3px] text-[12px] font-semibold">
              <Link
                href="/access"
                className={`rounded-[8px] px-2.5 py-1 ${!awayOnly ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'}`}
              >
                All {d.today.entries + d.today.denied}
              </Link>
              <Link
                href="/access?f=away"
                className={`rounded-[8px] px-2.5 py-1 ${awayOnly ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'}`}
              >
                Turned away {d.today.denied}
              </Link>
            </nav>
          </header>
          {shown.length ? (
            <ul className="divide-y divide-[#F0F2F6]">
              {shown.map((e, i) => (
                <EventRow key={`${e.at.getTime()}-${i}`} e={e} canPay={canPay} />
              ))}
            </ul>
          ) : (
            <p className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-ink-500">
              {awayOnly ? (
                <>
                  <CircleCheck size={16} className="text-emerald-600" /> Nobody was turned away today.
                </>
              ) : (
                'No one has come through the doors yet today.'
              )}
            </p>
          )}
        </section>

        <div className="grid gap-4">
          <section className={`${card} overflow-hidden`} id="areas">
            <header className={head}>
              <h2 className="text-[14px] font-semibold">Areas &amp; doors</h2>
              {site && (
                <details className="group relative ml-auto">
                  <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-[9px] border border-[#E5E8EE] bg-white px-2.5 text-[12.5px] font-semibold hover:bg-slate-50">
                    <Plus size={14} /> Add area
                  </summary>
                  <form
                    action={saveZone}
                    className="absolute right-0 z-10 mt-2 flex w-72 flex-col gap-2 rounded-xl border border-[#E7EBF3] bg-white p-3 shadow-lg"
                  >
                    <input type="hidden" name="siteId" value={site.id} />
                    <label className="text-[12px] font-semibold text-ink-700" htmlFor="new-area">
                      Area name
                    </label>
                    <input
                      id="new-area"
                      name="name"
                      required
                      maxLength={60}
                      placeholder="e.g. Studio 2"
                      className="input"
                    />
                    <p className="text-[11.5px] text-ink-500">{who} links its door when it’s fitted.</p>
                    <SubmitButton pendingText="Adding…" className="btn-primary">
                      Add area
                    </SubmitButton>
                  </form>
                </details>
              )}
            </header>
            <ul className="divide-y divide-[#F0F2F6]">
              {d.zones.map((z) => (
                <li key={z.id} className="px-4 py-3">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-slate-100 text-ink-700">
                        <DoorOpen size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <b className="block text-[13.5px] font-semibold">{z.name}</b>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {z.doors.length ? (
                            z.doors.map((n) => (
                              <span
                                key={n}
                                className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] text-ink-700"
                              >
                                {n}
                              </span>
                            ))
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-medium text-amber-800 ring-1 ring-amber-200">
                              No door yet{setup ? '' : `: ${who} links it`}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 text-[12px] tabular-nums text-ink-500">{z.today} today</span>
                      <span className="shrink-0 text-[12px] font-semibold text-ink-500 group-open:text-ink-900">
                        Edit
                      </span>
                    </summary>
                    <form action={saveZone} className="mt-3 flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
                      <input type="hidden" name="zoneId" value={z.id} />
                      <input type="hidden" name="siteId" value={z.site_id} />
                      <input
                        name="name"
                        required
                        maxLength={60}
                        defaultValue={z.name}
                        aria-label="Area name"
                        className="input"
                      />
                      {setup && (
                        <div className="flex flex-wrap gap-1.5">
                          {(d.readers[z.site_id] ?? []).map((r) => (
                            <label
                              key={r.id}
                              className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[12px] ring-1 ring-[#E5E8EE]"
                            >
                              <input
                                type="checkbox"
                                name="readers"
                                value={r.id}
                                defaultChecked={z.reader_ids.includes(r.id)}
                                className="h-3.5 w-3.5 accent-[#047857]"
                              />
                              {r.name}
                            </label>
                          ))}
                          {(d.readers[z.site_id] ?? []).length === 0 && (
                            <span className="text-[12px] text-ink-500">No readers read from AxTraxNG yet.</span>
                          )}
                        </div>
                      )}
                      <SubmitButton pendingText="Saving…" className="btn-ghost w-fit px-3 py-1.5 text-xs">
                        Save
                      </SubmitButton>
                    </form>
                  </details>
                </li>
              ))}
              {d.zones.length === 0 && (
                <li className="px-4 py-6 text-center text-[13px] text-ink-500">
                  No areas yet. Add one, or add a service and its area is created for you.
                </li>
              )}
            </ul>
          </section>

          <section className={`${card} overflow-hidden`}>
            <header className={head}>
              <ShieldCheck size={16} className="text-emerald-600" />
              <h2 className="text-[14px] font-semibold">Changes made in the door software</h2>
              {d.tamper.length > 0 && (
                <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-700">
                  {d.tamper.length} put back
                </span>
              )}
            </header>
            {d.tamper.length === 0 ? (
              <p className="flex items-center gap-2 px-4 py-5 text-[13px] text-ink-500">
                <CircleCheck size={15} className="text-emerald-600" /> Nobody changed access in the door software in the
                last 30 days.
              </p>
            ) : (
              <>
                <p className="px-4 pt-3 text-[12px] text-ink-500">
                  Someone changed these directly on the door PC. Lango put back what each person paid for.
                </p>
                <ul className="divide-y divide-[#F0F2F6]">
                  {d.tamper.slice(0, 5).map((t) => (
                    <li key={`${t.at.getTime()}-${t.member_no}`} className="flex gap-3 px-4 py-2.5 text-[12.5px]">
                      <span className="w-24 shrink-0 text-ink-500">
                        {day(t.at)}, {hm(t.at)}
                      </span>
                      <span>
                        <b className="font-semibold">{t.name ?? `Member ${t.member_no}`}</b> {changed(t.changes)}.
                      </span>
                    </li>
                  ))}
                </ul>
                {d.tamper.length > 5 && (
                  <details className="border-t border-[#F0F2F6]">
                    <summary className="cursor-pointer list-none px-4 py-2.5 text-[12.5px] font-semibold text-ink-500 hover:text-ink-900">
                      Show all {d.tamper.length}
                    </summary>
                    <ul className="divide-y divide-[#F0F2F6]">
                      {d.tamper.slice(5).map((t) => (
                        <li key={`${t.at.getTime()}-${t.member_no}`} className="flex gap-3 px-4 py-2.5 text-[12.5px]">
                          <span className="w-24 shrink-0 text-ink-500">
                            {day(t.at)}, {hm(t.at)}
                          </span>
                          <span>
                            <b className="font-semibold">{t.name ?? `Member ${t.member_no}`}</b> {changed(t.changes)}.
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {setup && (
        <section className={`${card} mt-6 p-5`}>
          <div className="flex items-center gap-2.5">
            <Wrench size={16} className="text-ink-500" />
            <h2 className="text-[14px] font-semibold">Installer setup</h2>
            <span className="text-[12px] text-ink-500">Only installers see this</span>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {d.sites.map((st) => {
              const b = d.bridges.find((x) => x.site_id === st.id);
              return (
                <div key={st.id} className="rounded-xl bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-[13.5px] font-semibold">
                    <MonitorSmartphone size={15} /> {st.name}
                    <span className="ml-auto text-[12px] font-normal text-ink-500">
                      {b?.last_seen_at ? `seen ${ago(b.last_seen_at)}` : 'not installed'}
                    </span>
                  </div>
                  {b?.pair_code && (
                    <div className="mt-3 space-y-2">
                      <CopyField value={b.pair_code} label="Pairing code" />
                      <CopyField value={`irm ${base}/bridge/install.ps1 | iex`} label="Install command" />
                      <p className="text-[11.5px] text-ink-500">
                        On the AxTraxNG PC: PowerShell as Administrator, paste, then give the pairing code and the
                        AxTraxNG operator login (it stays on the PC).
                      </p>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {b?.last_seen_at && (
                      <form action={requestInventory}>
                        <input type="hidden" name="siteId" value={st.id} />
                        <SubmitButton pendingText="Asking…" className="btn-ghost px-3 py-1.5 text-xs">
                          <RefreshCw size={13} /> Read AxTraxNG again
                        </SubmitButton>
                      </form>
                    )}
                    {b?.last_seen_at && (
                      <form action={reissuePairCode}>
                        <SubmitButton pendingText="Issuing…" className="btn-ghost px-3 py-1.5 text-xs">
                          <Download size={13} /> New PC? New pairing code
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                  <p className="mt-2 text-[11.5px] text-ink-500">
                    Link door readers to areas with Edit under Areas &amp; doors.
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
