import 'server-only';
import { withTenant } from '@lango/db';
import { type CommChannel, matchMember, platformEmailConfig, platformSmsConfig } from '@lango/server';
import { db } from '@/server/db';

export type Filter = 'all' | 'unread' | 'waiting' | 'done';

export interface ConvRow {
  id: string;
  channel: CommChannel;
  address: string;
  name: string | null;
  member_id: string | null;
  member_no: number | null;
  status: 'open' | 'done';
  unread: number;
  last_at: Date;
  preview: string | null;
  last_dir: 'in' | 'out' | null;
}

/** The conversation list: newest first, filtered by channel, state and a search over name, number and address. */
export async function inbox(tenantId: string, o: { ch?: string; f?: Filter; q?: string }) {
  const ch = ['sms', 'whatsapp', 'email'].includes(o.ch ?? '') ? (o.ch as string) : '';
  const f = o.f ?? 'all';
  const q = (o.q ?? '').trim().toLowerCase();
  const digits = q.replace(/\D/g, '').replace(/^254/, '').replace(/^0/, '');
  return withTenant(db(), tenantId, async (tx) => {
    const rows = await tx<ConvRow[]>`
      select c.id, c.channel, c.address, coalesce(m.first_name || ' ' || m.last_name, c.name) as name, c.member_id,
             m.member_no, c.status, c.unread, c.last_at, l.body as preview, l.dir as last_dir
      from conversations c
      left join members m on m.id = c.member_id
      left join lateral (
        select body, dir from (
          select body, direction as dir, created_at from comm_messages where conversation_id = c.id
          union all
          select body, 'out', created_at from sms_messages where conversation_id = c.id
        ) x order by created_at desc limit 1) l on true
      where (${ch} = '' or c.channel = ${ch})
        and (${f} <> 'unread' or c.unread > 0)
        and (${f} <> 'waiting' or (c.status = 'open' and l.dir = 'in'))
        and (case when ${f} = 'done' then c.status = 'done' else c.status = 'open' or ${f} = 'all' end)
        and (${q} = '' or lower(coalesce(m.first_name || ' ' || m.last_name, c.name, '')) like ${`%${q}%`}
             or lower(c.address) like ${`%${q}%`} or m.member_no::text = ${q}
             or (${digits} <> '' and c.address like ${`%${digits}%`}))
      order by c.last_at desc limit 200`;
    const [counts] = await tx<{ unread: number; waiting: number }[]>`
      select count(*) filter (where unread > 0)::int as unread,
             count(*) filter (where status = 'open' and exists (
               select 1 from comm_messages x where x.conversation_id = c.id and x.direction = 'in'
                 and x.created_at >= c.last_at - interval '1 second'))::int as waiting
      from conversations c`;
    return { rows, counts: counts ?? { unread: 0, waiting: 0 } };
  });
}

export interface ThreadMsg {
  id: string;
  dir: 'in' | 'out';
  body: string;
  subject: string | null;
  status: string;
  error: string | null;
  by: string | null;
  auto: string | null;
  at: Date;
}

export interface Contact {
  id: string;
  member_no: number;
  name: string;
  phone: string | null;
  email: string | null;
  ends: Date | null;
  plan: string | null;
  last_visit: Date | null;
  paid_total: number;
}

/**
 * One conversation: its messages, plus the club's automatic messages to the same phone or email (receipts,
 * reminders by SMS) so staff see everything the person was sent. Opening it marks it read.
 */
export async function thread(tenantId: string, id: string) {
  return withTenant(db(), tenantId, async (tx) => {
    const [c] = await tx<
      {
        id: string;
        channel: CommChannel;
        address: string;
        name: string | null;
        member_id: string | null;
        status: 'open' | 'done';
        last_in_at: Date | null;
      }[]
    >`select id, channel, address, name, member_id, status, last_in_at from conversations where id = ${id}`;
    if (!c) return null;
    await tx`update conversations set unread = 0 where id = ${id} and unread > 0`;
    if (!c.member_id) {
      // They may have joined (or had this number added) since the conversation started.
      const m = await matchMember(tx, c.channel, c.address);
      if (m) {
        await tx`update conversations set member_id = ${m.id} where id = ${id}`;
        c.member_id = m.id;
      }
    }
    const msgs = await tx<ThreadMsg[]>`
      select * from (
        select id::text, direction as dir, body, subject, status, error, staff_name as by, null as auto, created_at as at
        from comm_messages where conversation_id = ${id}
        union all
        select id::text, 'out', body, null, status, error, staff_name, case when conversation_id is null then kind end,
               coalesce(sent_at, created_at)
        from sms_messages
        where ${c.channel} = 'sms' and (conversation_id = ${id}
              or (conversation_id is null and phone = ${c.address} and created_at > now() - interval '90 days'))
      ) t order by at asc limit 400`;
    const [contact] = c.member_id
      ? await tx<Contact[]>`
          select m.id, m.member_no, m.first_name || ' ' || m.last_name as name, m.phone, m.email,
                 (select max(ends_at) from entitlements e where e.member_id = m.id) as ends,
                 (select coalesce(pr.name, l.label) from payment_lines l join payments p on p.id = l.payment_id
                    left join products pr on pr.id = l.product_id
                  where p.member_id = m.id and p.status = 'applied' order by p.paid_at desc limit 1) as plan,
                 (select max(at) from access_events a where a.member_no = m.member_no and a.granted) as last_visit,
                 (select coalesce(sum(amount_kes), 0)::int from payments p where p.member_id = m.id and p.status = 'applied') as paid_total
          from members m where m.id = ${c.member_id}`
      : [];
    return { c, msgs, contact: contact ?? null };
  });
}

export interface ChannelState {
  sms: { on: boolean; why?: string };
  whatsapp: { on: boolean; number?: string };
  email: { on: boolean; inbound: boolean; address?: string };
}

/** Which channels this club can use right now (set up by NAVAC or the club's partner). */
export async function channelState(tenantId: string): Promise<ChannelState> {
  const [platformSms, platformEmail, rows] = await Promise.all([
    platformSmsConfig(db()),
    platformEmailConfig(db()),
    withTenant(
      db(),
      tenantId,
      (tx) => tx<
        { channel: string; enabled: boolean; config: { displayPhone?: string }; on: boolean | null; slug: string }[]
      >`
        select c.channel, c.enabled, c.config, null::boolean as on, t.slug
        from tenants t left join comm_channels c on c.tenant_id = t.id where t.id = ${tenantId}
        union all
        select 'notify', coalesce((data->'notifications'->>'enabled')::boolean, false), '{}'::jsonb, null, ''
        from tenant_settings where tenant_id = ${tenantId}`,
    ),
  ]);
  const get = (k: string) => rows.find((r) => r.channel === k);
  const slug = rows.find((r) => r.slug)?.slug ?? '';
  const smsOn = !!platformSms?.apiKey && !!get('notify')?.enabled;
  return {
    sms: {
      on: smsOn,
      why: !platformSms?.apiKey
        ? 'SMS is not connected on the platform yet.'
        : smsOn
          ? undefined
          : 'SMS is off for the club.',
    },
    whatsapp: { on: !!get('whatsapp')?.enabled, number: get('whatsapp')?.config?.displayPhone },
    email: {
      on: !!get('email')?.enabled && !!platformEmail,
      inbound: !!platformEmail?.inboundDomain,
      address: platformEmail?.inboundDomain ? `${slug}@${platformEmail.inboundDomain}` : undefined,
    },
  };
}

/** Every SMS the club sent automatically (receipts, reminders, news), newest first. */
export async function automaticLog(tenantId: string) {
  return withTenant(
    db(),
    tenantId,
    (tx) => tx<
      {
        id: string;
        channel: 'sms' | 'email';
        to: string;
        name: string | null;
        member_id: string | null;
        body: string;
        kind: string;
        status: string;
        error: string | null;
        at: Date;
      }[]
    >`
      select * from (
        select s.id::text, 'sms' as channel, s.phone as to, m.first_name || ' ' || m.last_name as name, s.member_id,
               s.body, s.kind, s.status, s.error, s.created_at as at
        from sms_messages s left join members m on m.id = s.member_id where s.conversation_id is null
      ) x order by at desc limit 100`,
  );
}
