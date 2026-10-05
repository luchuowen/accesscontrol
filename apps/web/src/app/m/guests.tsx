import { withTenant } from '@lango/db';
import { guestOffers, memberRules, myGuestPasses } from '@lango/server';
import { ChevronLeft, Clock, MapPin, MessageCircle, Phone, Plus } from 'lucide-react';
import Link from 'next/link';
import { kes } from '@/lib/format';
import { db } from '@/server/db';
import { GuestWizard } from './guest-wizard';

type Who = { tenantId: string; memberId: string };
type GuestPassRow = Awaited<ReturnType<typeof myGuestPasses>>[number];

function Top({ title, sub, back = '/m?v=more' }: { title: string; sub?: string; back?: string }) {
  return (
    <header className="mb-4">
      <Link
        href={back}
        className="-ml-1 inline-flex items-center gap-0.5 py-1 text-[13px] font-semibold text-ink-500 hover:text-ink-900"
      >
        <ChevronLeft size={16} /> Back
      </Link>
      <h1 className="mt-2 text-[21px] font-bold leading-tight">{title}</h1>
      {sub && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-500">{sub}</p>}
    </header>
  );
}
const local = (p: string | null) =>
  (p ?? '')
    .replace(/\D/g, '')
    .replace(/^254/, '0')
    .replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
const day = (s: string) =>
  new Date(`${s}T12:00:00+03:00`).toLocaleDateString('en-KE', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

async function guestState(who: Who) {
  return withTenant(db(), who.tenantId, async (tx) => {
    const rules = (await memberRules(tx, who.tenantId)).guest;
    const offers = await guestOffers(tx);
    const [m] = await tx<{ phone: string | null }[]>`select phone from members where id = ${who.memberId}`;
    const [used] = await tx<{ n: number }[]>`
      select count(*)::int as n from guest_passes where host_id = ${who.memberId} and status in ('paid', 'used')
        and created_at > date_trunc('month', now())`;
    const passes = await myGuestPasses(tx, who.memberId);
    return {
      rules,
      offers,
      phone: local(m?.phone ?? null),
      left: Math.max(0, rules.perMonth - (used?.n ?? 0)),
      passes,
    };
  });
}

/** Bring a guest (design A wizard), or why it isn't possible. */
export async function GuestScreen({ who, sp }: { who: Who; sp: { e?: string } }) {
  const g = await guestState(who);
  const stop = (why: string) => (
    <>
      <Top title="Bring a guest" />
      <p className="rounded-2xl border border-[#E4E8EF] bg-white p-4 text-[13.5px] text-ink-500">{why}</p>
    </>
  );
  if (!g.rules.enabled || !g.offers.length)
    return stop('This club does not sell guest passes online. Ask at reception.');
  if (g.left === 0) return stop(`You have used your ${g.rules.perMonth} guest passes for this month.`);
  return (
    <GuestWizard
      offers={g.offers.map((o) => ({ productId: o.productId, service: o.service, price: o.price }))}
      phone={g.phone}
      left={g.left}
      error={sp.e ? decodeURIComponent(sp.e) : null}
    />
  );
}

/** The member's guest passes with their codes. */
export async function GuestList({ who, sp }: { who: Who; sp: { n?: string } }) {
  const g = await guestState(who);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Nairobi' });
  const state = (p: GuestPassRow) =>
    p.status === 'used'
      ? ['Used', 'text-ink-500']
      : p.status === 'awaiting_payment'
        ? ['Waiting for payment', 'text-amber-700']
        : p.visit_date < today
          ? ['Not used', 'text-ink-500']
          : ['Ready', 'text-emerald-700'];
  return (
    <>
      <Top title="My guests" sub={`${g.left} of ${g.rules.perMonth} guest passes left this month.`} />
      {sp.n === 'guest-sent' && (
        <p
          className="mb-4 rounded-xl bg-emerald-50 p-3 text-[13px] text-emerald-800 ring-1 ring-emerald-200"
          role="status"
        >
          Check your phone and enter your M-Pesa PIN. Once paid, your guest gets their code by SMS.
        </p>
      )}
      {g.passes.length === 0 ? (
        <p className="rounded-2xl border border-[#E4E8EF] bg-white p-4 text-[13.5px] text-ink-500">No guests yet.</p>
      ) : (
        <ul className="divide-y divide-[#EEF1F6] overflow-hidden rounded-2xl border border-[#E4E8EF] bg-white">
          {g.passes.map((p: GuestPassRow) => {
            const [label, tone] = state(p);
            return (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3.5">
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[14px] font-semibold">{p.guest_name}</b>
                  <span className="block text-[12px] text-ink-500">
                    {day(p.visit_date)} · {p.what} · {kes(p.total_kes)}
                  </span>
                  <span className={`block text-[12px] font-semibold ${tone}`}>{label}</span>
                </span>
                {p.status === 'paid' && p.visit_date >= today && (
                  <span className="shrink-0 rounded-lg bg-[#F1F4F8] px-2.5 py-1.5 font-mono text-[15px] font-bold tracking-[0.12em]">
                    {p.code.slice(0, 3)} {p.code.slice(3)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {g.rules.enabled && g.offers.length > 0 && g.left > 0 && (
        <Link
          href="/m?v=guest"
          className="mt-5 flex h-[52px] items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-[15px] font-bold text-white transition hover:bg-emerald-700"
        >
          <Plus size={18} /> Bring a guest
        </Link>
      )}
    </>
  );
}

/** Club information: hours, address, phone and WhatsApp, as the club set them. */
export async function ClubScreen({ who }: { who: Who }) {
  const d = await withTenant(db(), who.tenantId, async (tx) => {
    const info = (await memberRules(tx, who.tenantId)).info;
    const [t] = await tx<{ name: string }[]>`select name from tenants where id = ${who.tenantId}`;
    const [wa] = await tx<{ phone: string | null }[]>`
      select config->>'displayPhone' as phone from comm_channels where channel = 'whatsapp' and enabled`;
    return { info, name: t?.name ?? '', wa: wa?.phone ?? null };
  });
  const row = (icon: React.ReactNode, label: string, body: React.ReactNode) => (
    <div className="flex gap-3 px-4 py-3.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-500">{label}</div>
        <div className="mt-0.5 whitespace-pre-line text-[14px] leading-relaxed">{body}</div>
      </div>
    </div>
  );
  const empty = !d.info.hours && !d.info.address && !d.info.phone && !d.wa;
  return (
    <>
      <Top title={d.name} />
      {empty ? (
        <p className="rounded-2xl border border-[#E4E8EF] bg-white p-4 text-[13.5px] text-ink-500">
          The club hasn’t added its opening hours and contacts yet.
        </p>
      ) : (
        <div className="divide-y divide-[#EEF1F6] overflow-hidden rounded-2xl border border-[#E4E8EF] bg-white">
          {d.info.hours && row(<Clock size={17} />, 'Opening hours', d.info.hours)}
          {d.info.address && row(<MapPin size={17} />, 'Where we are', d.info.address)}
          {d.info.phone && row(<Phone size={17} />, 'Call us', <span className="tabular-nums">{d.info.phone}</span>)}
          {d.wa &&
            row(
              <MessageCircle size={17} />,
              'WhatsApp',
              <a
                href={`https://wa.me/${d.wa.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener"
                className="font-semibold text-emerald-700"
              >
                {d.wa}
              </a>,
            )}
        </div>
      )}
    </>
  );
}
