import 'server-only';
import { billingState, CYCLE_MONTHS, type Cycle, onboardingChecklist, platformSmsConfig } from '@lango/server';
import { DateTime } from 'luxon';
import { db } from '@/server/db';

/**
 * Partner Home, design A "Dashboard" (approved 3 Oct 2026). One read of everything the partner console's Home shows,
 * scoped by who is asking: NAVAC admins see every partner and NAVAC's own figures; a partner admin sees its own
 * clubs and its own money; technicians and NAVAC support see clubs and doors but no money.
 */
export type Stage = 'live' | 'setup';
export interface HomeClub {
  id: string;
  name: string;
  partner: string | null;
  stage: Stage;
  done: number;
  total: number;
  nextStep: string | null;
  bridgeSeen: Date | null;
  doorOffline: boolean;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerAccepted: boolean;
  createdAt: Date;
  // money (null when the viewer may not see it)
  feeKes: number | null;
  cycle: Cycle | null;
  paidUntil: string | null;
  billing: ReturnType<typeof billingState> | null;
  setupFeeKes: number | null;
  setupPaid: boolean;
  setupInvoicedAt: Date | null;
  monthlyShare: number;
}
interface Earning {
  tenant_id: string;
  club: string;
  partner: string;
  kind: 'setup' | 'subscription';
  amount_kes: number;
  earned_at: Date;
  available_at: Date;
  status: 'earned' | 'paid' | 'reversed';
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export async function partnerHome(uid: string, days: number) {
  const sql = db();
  const [scope] = await sql<{ allowed: boolean; partner_id: string | null; platform: boolean }[]>`
    select * from app_money_scope(${uid})`;
  const money = !!scope?.allowed;
  const platform = !!scope?.platform;
  const now = DateTime.now().setZone('Africa/Nairobi');
  const from = now.minus({ days });
  const [clubs, owners, billing, earnings, terms, revenue, smsCfg] = await Promise.all([
    sql<{ id: string; name: string; partner: string | null; created_at: Date; bridge_seen: Date | null }[]>`
      select c.id, c.name, c.partner, c.created_at, st.bridge_seen
      from app_partner_clubs(${uid}) c join app_partner_stats(${uid}) st on st.tenant_id = c.id`,
    sql<{ tenant_id: string; owner_name: string | null; owner_email: string | null; accepted: boolean }[]>`
      select * from app_partner_club_owners(${uid})`,
    money
      ? sql<
          {
            tenant_id: string;
            fee_kes: number | null;
            cycle: Cycle | null;
            paid_until: string | null;
            setup_fee_kes: number | null;
            setup_paid: boolean;
            setup_invoiced_at: Date | null;
          }[]
        >`select tenant_id, fee_kes, cycle, to_char(paid_until, 'YYYY-MM-DD') as paid_until, setup_fee_kes, setup_paid,
                 setup_invoiced_at from app_partner_club_billing(${uid})`
      : Promise.resolve([]),
    money ? sql<Earning[]>`select * from app_partner_earnings(${uid})` : Promise.resolve([] as Earning[]),
    money
      ? sql<
          {
            partner: string;
            sub_pct: string | null;
            setup_pct: string | null;
            wht_pct: string;
            payout_method: string | null;
            payout_to: string | null;
          }[]
        >`select partner, sub_pct, setup_pct, wht_pct, payout_method, payout_to from app_partner_terms(${uid})`
      : Promise.resolve([]),
    platform
      ? sql<
          {
            gateway_kes: bigint;
            cash_kes: bigint;
            plans_kes: bigint;
            setup_kes: bigint;
            sms_kes: bigint;
            sms_units: bigint;
            shares_kes: bigint;
          }[]
        >`select * from app_platform_revenue(${uid}, ${from.toJSDate()}, ${now.plus({ minutes: 1 }).toJSDate()})`
      : Promise.resolve([]),
    platform ? platformSmsConfig(sql) : Promise.resolve(null),
  ]);
  const checklists = await Promise.all(clubs.map((c) => onboardingChecklist(sql, c.id)));
  const ownerOf = new Map(owners.map((o) => [o.tenant_id, o]));
  const billOf = new Map(billing.map((b) => [b.tenant_id, b]));
  const termsOf = new Map(terms.map((t) => [t.partner, t]));
  const today = now.toISODate() ?? '';

  const list: HomeClub[] = clubs.map((c, i) => {
    const items = checklists[i] ?? [];
    const done = items.filter((x) => x.done).length;
    const o = ownerOf.get(c.id);
    const b = billOf.get(c.id);
    const plan = b
      ? {
          plan_name: '',
          fee_kes: b.fee_kes,
          cycle: (b.cycle ?? 'monthly') as Cycle,
          paid_until: b.paid_until,
          billing_phone: null,
          billing_email: null,
          setup_fee_kes: b.setup_fee_kes,
          setup_paid: b.setup_paid,
        }
      : null;
    const state = money && b && b.fee_kes != null ? billingState(plan, today) : null;
    const pct = Number(termsOf.get(c.partner ?? '')?.sub_pct ?? 0);
    // What this club's subscription is worth a month: to the partner (its share), or to NAVAC (the whole fee).
    const monthly = b?.fee_kes ? b.fee_kes / CYCLE_MONTHS[(b.cycle ?? 'monthly') as Cycle] : 0;
    return {
      id: c.id,
      name: c.name,
      partner: c.partner,
      stage: items.length && done === items.length ? 'live' : 'setup',
      done,
      total: items.length,
      nextStep: items.find((x) => !x.done)?.label ?? null,
      bridgeSeen: c.bridge_seen,
      doorOffline: !!c.bridge_seen && Date.now() - c.bridge_seen.getTime() > 15 * 60_000,
      ownerName: o?.owner_name ?? null,
      ownerEmail: o?.owner_email ?? null,
      ownerAccepted: !!o?.accepted,
      createdAt: c.created_at,
      feeKes: b?.fee_kes ?? null,
      cycle: b?.cycle ?? null,
      paidUntil: b?.paid_until ?? null,
      billing: state,
      setupFeeKes: b?.setup_fee_kes ?? null,
      setupPaid: !!b?.setup_paid,
      setupInvoicedAt: b?.setup_invoiced_at ?? null,
      monthlyShare: Math.round(platform ? monthly : (monthly * pct) / 100),
    };
  });

  // Earnings: in this period vs the one before, six periods for the spark, ready / on hold / paid.
  const live = earnings.filter((e) => e.status !== 'reversed');
  const inWin = (e: Earning, a: DateTime, b: DateTime) => e.earned_at >= a.toJSDate() && e.earned_at < b.toJSDate();
  const earnedNow = sum(live.filter((e) => inWin(e, from, now.plus({ minutes: 1 }))).map((e) => e.amount_kes));
  const earnedPrev = sum(live.filter((e) => inWin(e, from.minus({ days }), from)).map((e) => e.amount_kes));
  const spark = Array.from({ length: 6 }, (_, k) => {
    const end = now.plus({ minutes: 1 }).minus({ days: days * (5 - k) });
    return sum(live.filter((e) => inWin(e, end.minus({ days }), end)).map((e) => e.amount_kes));
  });
  const unpaid = live.filter((e) => e.status === 'earned');
  const ready = unpaid.filter((e) => e.available_at <= new Date());
  const readyKes = sum(ready.map((e) => e.amount_kes));
  const holdKes = sum(unpaid.filter((e) => e.available_at > new Date()).map((e) => e.amount_kes));
  const whtKes = Math.round(sum(ready.map((e) => (e.amount_kes * Number(termsOf.get(e.partner)?.wht_pct ?? 0)) / 100)));
  const paidKes = sum(live.filter((e) => e.status === 'paid').map((e) => e.amount_kes));
  const firstHold = unpaid
    .filter((e) => e.available_at > new Date())
    .sort((a, b) => a.available_at.getTime() - b.available_at.getTime())[0]?.available_at;
  const payDay = now.day <= 5 ? now.set({ day: 5 }) : now.plus({ months: 1 }).set({ day: 5 });

  // Six calendar months, split into setup and subscription shares.
  const months = Array.from({ length: 6 }, (_, k) => {
    const m = now.startOf('month').minus({ months: 5 - k });
    const ofMonth = live.filter((e) => inWin(e, m, m.plus({ months: 1 })));
    return {
      label: m.toFormat('LLL'),
      setup: sum(ofMonth.filter((e) => e.kind === 'setup').map((e) => e.amount_kes)),
      subs: sum(ofMonth.filter((e) => e.kind === 'subscription').map((e) => e.amount_kes)),
    };
  });
  const lifetime = sum(live.map((e) => e.amount_kes));
  const lifetimeSetup = sum(live.filter((e) => e.kind === 'setup').map((e) => e.amount_kes));
  const firstEarned = live[0]?.earned_at ?? null;
  const monthsSince = firstEarned
    ? Math.max(1, Math.ceil(now.diff(DateTime.fromJSDate(firstEarned), 'months').months))
    : 0;

  const t0 = terms.length === 1 ? terms[0] : null;
  const rev = revenue[0];
  const smsUnits = Number(rev?.sms_units ?? 0);
  const smsCost = smsCfg?.costKes ? smsUnits * smsCfg.costKes : null;
  return {
    money,
    platform,
    days,
    clubs: list,
    earned: { now: earnedNow, prev: earnedPrev, spark },
    payout: {
      readyKes,
      holdKes,
      whtKes,
      netKes: readyKes - whtKes,
      paidKes,
      payDay: payDay.toJSDate(),
      holdUntil: firstHold ?? null,
      method: t0?.payout_method ?? null,
      to: t0?.payout_to ?? null,
      partners: new Set(ready.map((e) => e.partner)).size,
    },
    terms: t0 ? { setup: t0.setup_pct, sub: t0.sub_pct } : null,
    termsMissing: platform ? terms.filter((t) => t.sub_pct == null && t.setup_pct == null).map((t) => t.partner) : [],
    months,
    lifetime,
    lifetimeSetup,
    monthsSince,
    navac: rev
      ? {
          gateway: Number(rev.gateway_kes),
          cash: Number(rev.cash_kes),
          collected: Number(rev.plans_kes) + Number(rev.setup_kes),
          sms: Number(rev.sms_kes),
          smsMargin: smsCost == null ? null : Math.round(Number(rev.sms_kes) - smsCost),
          shares: Number(rev.shares_kes),
        }
      : null,
  };
}
