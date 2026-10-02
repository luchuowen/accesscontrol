import { randomUUID } from 'node:crypto';
import { withTenant } from '@lango/db';
import { can } from '@lango/server';
import { ArrowLeft, CheckCircle2, Clock, CreditCard, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/notice';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Empty } from '@/components/ui';
import { member, products } from '@/lib/data';
import { date, dateTime, daysLeft, kes } from '@/lib/format';
import { requirePerm } from '@/lib/session';
import { db } from '@/server/db';
import { grantOverride, linkCard, recordDeskPayment, requestMpesa } from '../../actions';

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ n?: string }>;
}) {
  const s = await requirePerm('members.view');
  const { id } = await params;
  const { n } = await searchParams;
  const d = await member(s.tid, id);
  if (!d) notFound();
  const plans = (await products(s.tid)).filter((p) => p.on_sale && p.for_members);
  const now = Date.now();
  const current = d.ents.filter((e) => e.starts_at.getTime() <= now && e.ends_at.getTime() >= now);
  const until = d.ents.length ? new Date(Math.max(...d.ents.map((e) => e.ends_at.getTime()))) : null;
  const left = daysLeft(until);
  const synced = d.sync.every((x) => x.applied_version === x.version);
  const failed = d.sync.find((x) => x.error);
  const zones = [...new Set(plans.flatMap((p) => p.zone_keys))];
  const [ch] = await withTenant(
    db(),
    s.tid,
    (tx) =>
      tx<{ paybill: string | null; till: string | null }[]>`
      select data->'channels'->>'paybill' as paybill, data->'channels'->>'till' as till from tenant_settings`,
  );
  const payTo = ch?.paybill ? `Paybill ${ch.paybill}` : ch?.till ? `Till ${ch.till}` : null;
  return (
    <>
      <Link href="/members" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900">
        <ArrowLeft size={15} /> Members
      </Link>
      <Notice code={n} />
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-6 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="font-mono text-xs text-ink-500">
                Member #{d.m.member_no} · M-Pesa account {d.m.member_no}
              </div>
              <h1 className="mt-1 text-[26px] font-semibold tracking-tight">
                {d.m.first_name} {d.m.last_name}
              </h1>
              <div className="mt-1 text-sm text-ink-500">
                {d.m.phone ?? 'No phone'} · joined {date(d.m.created_at)}
              </div>
            </div>
            <div
              className={`rounded-2xl px-4 py-3 text-right ${current.length ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-ink-50 ring-1 ring-ink-100'}`}
            >
              <div className="label">{current.length ? 'Access active' : 'No access'}</div>
              <div className="mt-1 text-lg font-semibold">{until ? date(until) : '—'}</div>
              {left !== null && left >= 0 && <div className="text-xs text-ink-500">{left} days left</div>}
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {current.length ? (
              [...new Set(current.map((e) => e.zone_key))].map((z) => (
                <Badge key={z} tone="green">
                  <CheckCircle2 size={12} /> {z}
                </Badge>
              ))
            ) : (
              <Badge>Pays to enter</Badge>
            )}
          </div>
          <div
            className={`mt-6 flex items-center gap-3 rounded-xl p-3 text-sm ${failed ? 'bg-rose-50 text-rose-800' : synced ? 'bg-ink-50 text-ink-500' : 'bg-amber-50 text-amber-900'}`}
          >
            {failed ? (
              <ShieldAlert size={16} />
            ) : synced ? (
              <CheckCircle2 size={16} className="text-emerald-600" />
            ) : (
              <Clock size={16} />
            )}
            {failed
              ? `Doors could not be updated: ${failed.error}`
              : synced
                ? `Doors are in sync${d.sync[0]?.applied_at ? ` · updated ${dateTime(d.sync[0].applied_at)}` : ''}`
                : 'Waiting for the Site Bridge to update the doors…'}
          </div>

          <h2 className="label mt-8">Payments</h2>
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-ink-100">
              {d.pays.length === 0 && (
                <tr>
                  <td className="py-3 text-ink-500">No payments yet.</td>
                </tr>
              )}
              {d.pays.map((p) => (
                <tr key={p.id}>
                  <td className="py-2.5 text-ink-500">{dateTime(p.paid_at)}</td>
                  <td className="py-2.5">{p.product ?? '—'}</td>
                  <td className="py-2.5 text-right tabular-nums">{kes(p.amount_kes)}</td>
                  <td className="py-2.5 pl-4 text-right">
                    {p.status === 'applied' ? (
                      <Badge tone="green">applied</Badge>
                    ) : (
                      <Badge tone="amber">{p.status}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="label mt-8">Recent visits</h2>
          <div className="mt-3">
            {d.visits.length === 0 ? (
              <Empty>No door activity yet.</Empty>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {d.visits.map((v, i) => (
                  <li key={`${v.at.getTime()}-${i}`} className="flex items-center gap-2 text-sm">
                    <span className={`h-2 w-2 rounded-full ${v.granted ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    <span className="text-ink-500">{dateTime(v.at)}</span>
                    <span>{v.zone ?? '—'}</span>
                    {!v.granted && <span className="text-xs text-rose-700">denied</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="space-y-4">
          {can(s, 'payments.record') && (
            <form id="pay" action={requestMpesa} className="card scroll-mt-24 p-6">
              <div className="label">Send M-Pesa prompt</div>
              <input type="hidden" name="memberId" value={d.m.id} />
              <select name="productId" className="input mt-4" required>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {kes(p.price_kes)}
                  </option>
                ))}
              </select>
              <input name="phone" defaultValue={d.m.phone ?? ''} placeholder="07…" className="input mt-3" required />
              <SubmitButton pendingText="Sending to phone…" className="btn-primary mt-4 w-full">
                Send prompt to phone
              </SubmitButton>
              <p className="mt-3 text-xs text-ink-500">
                The member approves on their phone; doors open automatically once M-Pesa confirms.
              </p>
            </form>
          )}

          {can(s, 'payments.record') && (
            <form id="cash" action={recordDeskPayment} className="card scroll-mt-24 p-6">
              <div className="label">Cash at the desk</div>
              <input type="hidden" name="memberId" value={d.m.id} />
              <input type="hidden" name="nonce" value={randomUUID()} />
              <select name="productId" className="input mt-4" required>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {kes(p.price_kes)}
                  </option>
                ))}
              </select>
              <input type="hidden" name="channel" value="cash" />
              <SubmitButton pendingText="Recording…" className="btn-ghost mt-4 w-full">
                <CreditCard size={16} /> Record cash &amp; open doors
              </SubmitButton>
              {payTo && (
                <p className="mt-3 text-xs text-ink-500">
                  Or M-Pesa {payTo} with account <b>{d.m.member_no}</b>; access updates automatically.
                </p>
              )}
            </form>
          )}

          {can(s, 'members.edit') && (
            <form id="card" action={linkCard} className="card scroll-mt-24 p-6">
              <div className="label">Cards &amp; wristbands</div>
              <ul className="mt-3 space-y-1.5 text-sm">
                {d.creds.map((c) => (
                  <li key={c.id} className="flex justify-between">
                    <span className="capitalize">{c.kind}</span>
                    <span className="font-mono text-ink-500">
                      {c.site_code}:{String(c.card_code)}
                    </span>
                  </li>
                ))}
              </ul>
              <input type="hidden" name="memberId" value={d.m.id} />
              <div className="mt-4 flex gap-2">
                <input
                  name="cardCode"
                  type="number"
                  min={1}
                  max={65535}
                  required
                  placeholder="Card number"
                  className="input"
                />
                <SubmitButton pendingText="Linking…" className="btn-ghost">
                  Link
                </SubmitButton>
              </div>
            </form>
          )}

          {can(s, 'access.comp') && (
            <form action={grantOverride} className="card p-6">
              <div className="label">Complimentary access</div>
              <input type="hidden" name="memberId" value={d.m.id} />
              <div className="mt-4 grid grid-cols-2 gap-2">
                <select name="zone" className="input">
                  {zones.map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
                <input name="days" type="number" min={1} max={31} defaultValue={1} className="input" />
              </div>
              <input
                name="reason"
                required
                minLength={5}
                placeholder="Reason (shown on owner reports)"
                className="input mt-2"
              />
              <SubmitButton pendingText="Granting…" className="btn-ghost mt-3 w-full">
                Grant
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
