import { withTenant } from '@lango/db';
import { Activity, CheckCircle2, Smartphone } from 'lucide-react';
import { date, daysLeft, kes } from '@/lib/format';
import { db } from '@/server/db';
import { memberLogin, memberPay, readMember } from './actions';

export const dynamic = 'force-dynamic';

export default async function MemberPortal({ searchParams }: { searchParams: Promise<{ e?: string; pay?: string }> }) {
  const sp = await searchParams;
  const who = await readMember();
  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-ink-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-md">
        <div className="mb-8 flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-ink-950">
            <Activity size={17} strokeWidth={2.5} />
          </div>
          <span className="font-semibold">Lango</span>
        </div>
        {children}
      </div>
    </div>
  );
  if (!who) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">Your membership</h1>
        <p className="mt-1 text-sm text-ink-300">Check your access and renew with M-Pesa before you arrive.</p>
        {sp.e && (
          <div className="mt-4 rounded-xl bg-rose-500/15 p-3 text-sm text-rose-200">
            We couldn&apos;t find that membership. Check your number and phone.
          </div>
        )}
        <form action={memberLogin} className="mt-6 space-y-3">
          <input
            name="club"
            placeholder="Club code (e.g. demo-club)"
            required
            className="input bg-white/5 text-white ring-white/10"
          />
          <input
            name="memberNo"
            inputMode="numeric"
            placeholder="Member number"
            required
            className="input bg-white/5 text-white ring-white/10"
          />
          <input
            name="phone"
            inputMode="tel"
            placeholder="Phone number"
            required
            className="input bg-white/5 text-white ring-white/10"
          />
          <button type="submit" className="btn w-full bg-brand-500 text-ink-950 hover:bg-brand-600">
            Continue
          </button>
        </form>
      </Shell>
    );
  }
  const d = await withTenant(db(), who.tenantId, async (tx) => {
    const [m] = await tx<
      { first_name: string; member_no: number }[]
    >`select first_name, member_no from members where id = ${who.memberId}`;
    const ents = await tx<
      { zone_key: string; ends_at: Date; starts_at: Date }[]
    >`select zone_key, starts_at, ends_at from entitlements where member_id = ${who.memberId}`;
    const plans = await tx<
      { id: string; name: string; price_kes: number }[]
    >`select id, name, price_kes from products where active and price_kes >= 100 order by price_kes`;
    const [t] = await tx<{ name: string }[]>`select name from tenants where id = ${who.tenantId}`;
    return { m, ents, plans, club: t?.name };
  });
  const now = Date.now();
  const live = d.ents.filter((e) => e.starts_at.getTime() <= now && e.ends_at.getTime() >= now);
  const until = d.ents.length ? new Date(Math.max(...d.ents.map((e) => e.ends_at.getTime()))) : null;
  return (
    <Shell>
      <div className="text-sm text-ink-300">{d.club}</div>
      <h1 className="text-2xl font-semibold tracking-tight">Hi {d.m?.first_name}</h1>
      <div
        className={`mt-6 rounded-3xl p-6 ${live.length ? 'bg-gradient-to-br from-brand-500 to-emerald-700 text-ink-950' : 'bg-white/5 ring-1 ring-white/10'}`}
      >
        <div className="text-xs font-medium uppercase tracking-widest opacity-70">Member #{d.m?.member_no}</div>
        <div className="mt-3 flex items-center gap-2 text-xl font-semibold">
          {live.length ? (
            <>
              <CheckCircle2 size={20} /> You&apos;re in
            </>
          ) : (
            'No active plan'
          )}
        </div>
        {until && (
          <div className="mt-1 text-sm opacity-80">
            Access until {date(until)}
            {live.length ? ` · ${daysLeft(until)} days left` : ''}
          </div>
        )}
        {live.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {[...new Set(live.map((e) => e.zone_key))].map((z) => (
              <span key={z} className="rounded-full bg-ink-950/15 px-2.5 py-0.5 text-xs font-medium capitalize">
                {z}
              </span>
            ))}
          </div>
        )}
      </div>
      {sp.pay === 'sent' && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-white/5 p-3 text-sm">
          <Smartphone size={16} /> Check your phone and enter your M-Pesa PIN. The doors update automatically.
        </div>
      )}
      {sp.pay === 'unavailable' && (
        <div className="mt-4 rounded-xl bg-amber-500/15 p-3 text-sm text-amber-100">
          Online payment isn&apos;t switched on for this club yet. Pay at reception.
        </div>
      )}
      <h2 className="mt-8 text-xs font-medium uppercase tracking-widest text-ink-300">Renew or add</h2>
      <div className="mt-3 space-y-2">
        {d.plans.map((p) => (
          <form
            key={p.id}
            action={memberPay}
            className="flex items-center justify-between rounded-2xl bg-white/5 p-4 ring-1 ring-white/10"
          >
            <input type="hidden" name="productId" value={p.id} />
            <div>
              <div className="text-sm font-medium">{p.name}</div>
              <div className="text-xs text-ink-300">{kes(p.price_kes)}</div>
            </div>
            <button type="submit" className="btn bg-white px-3 py-2 text-xs text-ink-950 hover:bg-ink-100">
              Pay with M-Pesa
            </button>
          </form>
        ))}
      </div>
    </Shell>
  );
}
