import { withTenant } from '@lango/db';
import { can } from '@lango/server';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  Inbox,
  Mail,
  MessageCircle,
  MessageSquare,
  RotateCcw,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SubmitButton } from '@/components/submit-button';
import { PageHeader } from '@/components/ui';
import { automaticLog, channelState, type Filter, inbox, thread } from '@/lib/comms-data';
import { ago, date, dateTime, kes, time } from '@/lib/format';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';
import { setDone } from './actions';
import { AutoRefresh, Composer, ListFilters, NewMessage, NewsDialog, ScrollEnd } from './inbox';

/**
 * Communications (design from NAVAC CRM, 2 Oct 2026): one inbox for SMS, WhatsApp and email with members and anyone
 * who writes to the club. List · thread · who it is. Channels are connected by NAVAC or the club's partner; what
 * the club sends automatically lives under Settings › Messages.
 */
type Params = { c?: string; ch?: string; f?: string; q?: string; view?: string; news?: string; m?: string };

const CH = {
  sms: { label: 'SMS', icon: MessageSquare, tone: 'bg-sky-600' },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, tone: 'bg-emerald-600' },
  email: { label: 'Email', icon: Mail, tone: 'bg-violet-600' },
} as const;

const KIND: Record<string, string> = {
  receipt: 'Receipt',
  unmatched: 'Payment noted',
  reminder: 'Renewal reminder',
  welcome: 'Welcome',
  winback: 'We miss you',
  announcement: 'Club news',
  otp: 'Sign-in code',
  system: 'Staff alert',
  topup: 'Credit receipt',
  test: 'Test',
};

const NOTICE: Record<string, string> = {
  forbidden: 'You can read messages but not answer them. Ask the owner for “Read and answer messages”.',
  'no-phone': 'No usable mobile number for that person.',
  'no-email': 'No email address for that person.',
  channel: 'Pick how to send it.',
};

const COLORS = ['bg-sky-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600', 'bg-rose-600', 'bg-teal-600'];
const colorFor = (s: string) => COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const initials = (s: string) =>
  s
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '#';
const pretty = (ch: string, a: string) => (ch === 'email' ? a : a.startsWith('254') ? `0${a.slice(3)}` : a);

function Avatar({ name, channel, size = 40 }: { name: string; channel: keyof typeof CH; size?: number }) {
  const I = CH[channel].icon;
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <span
        className={`grid h-full w-full place-items-center rounded-full text-[13px] font-semibold text-white ${colorFor(name)}`}
      >
        {initials(name)}
      </span>
      <span
        className={`absolute -right-0.5 -bottom-0.5 grid h-[17px] w-[17px] place-items-center rounded-full text-white ring-2 ring-white ${CH[channel].tone}`}
      >
        <I size={10} />
      </span>
    </span>
  );
}

function Tick({ status }: { status: string }) {
  if (status === 'failed') return <AlertCircle size={12} className="text-rose-500" />;
  if (status === 'read') return <CheckCheck size={12} className="text-sky-500" />;
  if (status === 'delivered') return <CheckCheck size={12} className="text-ink-300" />;
  if (status === 'sent') return <Check size={12} className="text-ink-300" />;
  return <span className="text-[10px] text-ink-300">waiting</span>;
}

export default async function Communications({ searchParams }: { searchParams: Promise<Params> }) {
  const s = await requireSession();
  if (!can(s, 'inbox.reply') && !can(s, 'messages.manage')) redirect('/?denied=1');
  const sp = await searchParams;
  const auto = sp.view === 'auto';
  const f = (['unread', 'waiting', 'done'].includes(sp.f ?? '') ? sp.f : 'all') as Filter;
  // The open conversation first: opening it marks it read, so the list below shows it read.
  const open = sp.c && /^[0-9a-f-]{36}$/.test(sp.c) ? await thread(s.tid, sp.c) : null;
  const [list, chans, log, [club]] = await Promise.all([
    inbox(s.tid, { ch: sp.ch, f, q: sp.q }),
    channelState(s.tid),
    auto ? automaticLog(s.tid) : [],
    withTenant(
      db(),
      s.tid,
      (tx) => tx<{ name: string; paybill: string | null; till: string | null }[]>`
        select t.name, ts.data->'channels'->>'paybill' as paybill, ts.data->'channels'->>'till' as till
        from tenants t left join tenant_settings ts on ts.tenant_id = t.id where t.id = ${s.tid}`,
    ),
  ]);
  const replier = can(s, 'inbox.reply');
  const usable = (
    [
      ['sms', 'SMS', chans.sms.on],
      ['whatsapp', 'WhatsApp', chans.whatsapp.on],
      ['email', 'Email', chans.email.on],
    ] as const
  )
    .filter((c) => c[2])
    .map(([key, label]) => ({ key, label }));
  const qs = (patch: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ch: sp.ch, f: sp.f, q: sp.q, ...patch })) if (v) u.set(k, v);
    return `/communications${u.size ? `?${u}` : ''}`;
  };
  const pay = club?.paybill ? `Paybill ${club.paybill}` : club?.till ? `Till ${club.till}` : null;
  const memberNo = open?.contact?.member_no;
  const quick = [
    {
      label: 'How to pay',
      text: pay
        ? `You can pay by M-Pesa: ${pay}, account ${memberNo ?? 'your member number'}. Your access updates within a minute of paying.`
        : 'Reply with your member number and we will send you an M-Pesa prompt.',
    },
    {
      label: 'Payment received',
      text: 'Thank you, we have received your payment. Your access is active. See you at the club!',
    },
    {
      label: 'Renewal reminder',
      text: `Hi${open?.contact ? ` ${open.contact.name.split(' ')[0]}` : ''}, your membership is ending soon. Renew any time to keep your access${pay ? `: ${pay}, account ${memberNo ?? 'your member number'}` : ''}.`,
    },
    { label: 'Thanks', text: 'Thank you for reaching out. We are glad to help.' },
  ];
  const c = open?.c;
  const name = c ? (open?.contact?.name ?? c.name ?? pretty(c.channel, c.address)) : '';
  const blocked = !c
    ? undefined
    : !replier
      ? 'You can read this conversation but not answer it.'
      : c.channel === 'sms' && !chans.sms.on
        ? chans.sms.why === 'SMS is off for the club.'
          ? 'SMS is off for the club. Turn it on in Settings › Messages & SMS.'
          : 'SMS isn’t connected yet. NAVAC sets it up.'
        : c.channel === 'whatsapp' && !chans.whatsapp.on
          ? 'WhatsApp is not connected for the club. Your partner sets it up.'
          : c.channel === 'whatsapp' && (!c.last_in_at || Date.now() - c.last_in_at.getTime() > 24 * 3600_000)
            ? 'WhatsApp only allows replies within 24 hours of their last message. Message them by SMS instead.'
            : c.channel === 'email' && !chans.email.on
              ? 'Email is not switched on for the club. Your partner sets it up.'
              : undefined;
  const lastIn = open?.msgs.filter((m) => m.dir === 'in').at(-1);
  const subjectHint = c?.channel === 'email' && lastIn?.subject ? lastIn.subject : null;
  const tab = (on: boolean, href: string, label: React.ReactNode) => (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${on ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900'}`}
    >
      {label}
    </Link>
  );
  return (
    <>
      <AutoRefresh />
      <PageHeader
        title="Communications"
        subtitle="Every SMS, WhatsApp and email with members and customers, in one place."
        actions={
          <div className="flex flex-wrap gap-2">
            {can(s, 'messages.manage') && <NewsDialog club={club?.name ?? ''} open={!!sp.news} audience={sp.news} />}
            {replier && <NewMessage channels={usable} />}
          </div>
        }
      />
      {sp.m && NOTICE[sp.m] && (
        <div className="mb-4 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900 ring-1 ring-amber-200">
          {NOTICE[sp.m]}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl bg-[#EEF1F6] p-1">
          {tab(
            !auto,
            '/communications',
            <>
              <Inbox size={14} /> Inbox
              {list.counts.unread > 0 && (
                <span className="rounded-full bg-emerald-600 px-1.5 text-[10.5px] text-white">
                  {list.counts.unread}
                </span>
              )}
            </>,
          )}
          {tab(
            auto,
            '/communications?view=auto',
            <>
              <Bot size={14} /> Sent automatically
            </>,
          )}
        </div>
        <div className="ml-auto flex flex-wrap gap-2 text-[11.5px]">
          {(['sms', 'whatsapp', 'email'] as const).map((k) => {
            const on = chans[k].on;
            const I = CH[k].icon;
            return (
              <span
                key={k}
                title={
                  k === 'whatsapp' && chans.whatsapp.number
                    ? chans.whatsapp.number
                    : k === 'email' && chans.email.address
                      ? `Replies arrive at ${chans.email.address}`
                      : undefined
                }
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ring-1 ${on ? 'bg-white text-ink-700 ring-[#E5E8EE]' : 'bg-[#F6F7F9] text-ink-300 ring-transparent'}`}
              >
                <I size={12} /> {CH[k].label}
                <i className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-emerald-500' : 'bg-ink-100'}`} />
              </span>
            );
          })}
        </div>
      </div>

      {auto ? (
        <section className="overflow-hidden rounded-2xl border border-[#E7EBF3] bg-white">
          <header className="border-b border-[#EEF1F6] px-5 py-3 text-[12.5px] text-ink-500">
            Receipts, reminders and news the club sends by SMS. Choose what goes out under Settings › Messages.
          </header>
          {log.length ? (
            <ul className="divide-y divide-[#F0F2F6]">
              {log.map((r) => (
                <li
                  key={r.id}
                  className="grid gap-1 px-5 py-3 text-[13px] sm:grid-cols-[130px_150px_1fr_80px] sm:items-center"
                >
                  <span className="text-[12px] text-ink-500 tabular-nums">{dateTime(r.at)}</span>
                  <span className="truncate">
                    {r.member_id ? (
                      <Link href={`/members/${r.member_id}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      <span className="text-ink-500">{pretty('sms', r.to)}</span>
                    )}
                    <span className="block text-[11.5px] text-ink-500">{KIND[r.kind] ?? r.kind}</span>
                  </span>
                  <span className="min-w-0 truncate text-ink-700" title={r.body}>
                    {r.body}
                    {r.error && r.status !== 'sent' && (
                      <span className="block truncate text-[11.5px] text-ink-500">{r.error}</span>
                    )}
                  </span>
                  <span
                    className={`justify-self-start rounded-full px-2 py-0.5 text-[11px] font-semibold sm:justify-self-end ${r.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : r.status === 'failed' ? 'bg-rose-50 text-rose-700' : r.status === 'queued' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-ink-500'}`}
                  >
                    {r.status === 'queued' ? 'waiting' : r.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-12 text-center text-sm text-ink-500">Nothing sent yet.</p>
          )}
        </section>
      ) : (
        <section className="grid h-[calc(100vh-230px)] min-h-[520px] overflow-hidden rounded-2xl border border-[#E7EBF3] bg-white lg:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_280px]">
          {/* list */}
          <div className={`min-h-0 flex-col border-[#EEF1F6] lg:flex lg:border-r ${c ? 'hidden' : 'flex'}`}>
            <ListFilters />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {list.rows.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[#F6F8FB] text-ink-300">
                    <Inbox size={20} />
                  </span>
                  <b className="text-[13px]">{sp.q || sp.ch || sp.f ? 'Nothing matches' : 'No conversations yet'}</b>
                  <p className="mx-auto mt-1 max-w-[230px] text-[12px] text-ink-500">
                    {sp.q || sp.ch || sp.f
                      ? 'Try another search or filter.'
                      : 'WhatsApp and email from members land here. Start one with New message.'}
                  </p>
                </div>
              ) : (
                <ul>
                  {list.rows.map((r) => {
                    const nm = r.name ?? pretty(r.channel, r.address);
                    const waiting = r.status === 'open' && r.last_dir === 'in';
                    return (
                      <li key={r.id}>
                        <Link
                          href={qs({ c: r.id })}
                          scroll={false}
                          className={`flex gap-3 border-b border-[#F3F5F8] px-3.5 py-3 transition ${c?.id === r.id ? 'bg-[#F2F6FC]' : 'hover:bg-[#FAFBFC]'}`}
                        >
                          <Avatar name={nm} channel={r.channel} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <b
                                className={`truncate text-[13px] ${r.unread ? 'text-ink-900' : 'font-semibold text-ink-700'}`}
                              >
                                {nm}
                              </b>
                              {r.member_no && <span className="text-[11px] text-ink-300">#{r.member_no}</span>}
                              <span className="ml-auto shrink-0 text-[10.5px] text-ink-300">{ago(r.last_at)}</span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span
                                className={`truncate text-[12px] ${r.unread ? 'font-medium text-ink-900' : 'text-ink-500'}`}
                              >
                                {r.last_dir === 'out' && 'You: '}
                                {r.preview ?? 'No messages yet'}
                              </span>
                              {waiting && (
                                <span
                                  title="Waiting for a reply"
                                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                                />
                              )}
                              {r.unread > 0 && (
                                <span className="ml-auto shrink-0 rounded-full bg-emerald-600 px-1.5 text-[10.5px] font-semibold text-white">
                                  {r.unread}
                                </span>
                              )}
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* thread */}
          <div className={`min-h-0 flex-col lg:flex ${c ? 'flex' : 'hidden'}`}>
            {!c ? (
              <div className="grid flex-1 place-items-center px-6 text-center">
                <div>
                  <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-[#F6F8FB] text-ink-300">
                    <MessageSquare size={22} />
                  </span>
                  <b className="text-[14px]">Pick a conversation</b>
                  <p className="mt-1 text-[12.5px] text-ink-500">
                    {list.counts.waiting > 0
                      ? `${list.counts.waiting} waiting for a reply.`
                      : 'Everyone has had an answer.'}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <header className="flex items-center gap-3 border-b border-[#EEF1F6] px-4 py-3">
                  <Link href={qs({})} className="text-ink-500 lg:hidden" aria-label="Back">
                    <ArrowLeft size={18} />
                  </Link>
                  <Avatar name={name} channel={c.channel} size={34} />
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[14px]">{name}</b>
                    <span className="text-[11.5px] text-ink-500">
                      {CH[c.channel].label} · {pretty(c.channel, c.address)}
                      {c.status === 'done' && ' · done'}
                    </span>
                  </div>
                  {replier && (
                    <form action={setDone}>
                      <input type="hidden" name="conversationId" value={c.id} />
                      <input type="hidden" name="done" value={c.status === 'done' ? '0' : '1'} />
                      <SubmitButton pendingText="" className="btn-ghost px-3 py-1.5 text-[12.5px]">
                        {c.status === 'done' ? (
                          <>
                            <RotateCcw size={14} /> Reopen
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={14} /> Done
                          </>
                        )}
                      </SubmitButton>
                    </form>
                  )}
                </header>
                <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-[#F7F8FA] px-4 py-4">
                  {open.msgs.length === 0 && (
                    <p className="py-10 text-center text-[12.5px] text-ink-500">
                      No messages yet. Write the first one.
                    </p>
                  )}
                  {open.msgs.map((m, i) => {
                    const prev = open.msgs[i - 1];
                    const day = date(m.at);
                    const showDay = !prev || date(prev.at) !== day;
                    const out = m.dir === 'out';
                    return (
                      <div key={m.id}>
                        {showDay && <div className="my-3 text-center text-[11px] font-medium text-ink-300">{day}</div>}
                        <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed shadow-[0_1px_1px_rgba(12,18,32,0.05)] ${
                              m.auto
                                ? 'border border-dashed border-[#D6DCE5] bg-white/70 text-ink-700'
                                : out
                                  ? 'rounded-br-md bg-[#DCF8C6] text-ink-900'
                                  : 'rounded-bl-md bg-white text-ink-900'
                            }`}
                          >
                            {m.auto && (
                              <div className="mb-0.5 flex items-center gap-1 text-[10.5px] font-semibold text-ink-500">
                                <Bot size={11} /> Automatic · {KIND[m.auto] ?? m.auto}
                              </div>
                            )}
                            {m.subject && <div className="mb-0.5 text-[12px] font-semibold">{m.subject}</div>}
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            <div className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] text-ink-500">
                              {out && m.by && <span>{m.by.split(' ')[0]} ·</span>}
                              {time(m.at)}
                              {out && <Tick status={m.status} />}
                            </div>
                            {m.error && m.status === 'failed' && (
                              <p className="mt-1 text-[11px] text-rose-700">{m.error}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <ScrollEnd dep={`${c.id}:${open.msgs.length}`} />
                </div>
                <Composer
                  key={c.id}
                  id={c.id}
                  channel={c.channel}
                  blocked={blocked}
                  quick={quick}
                  member={!!open.contact}
                />
                {subjectHint && (
                  <p className="-mt-2 px-4 pb-2 text-[11px] text-ink-300">Their subject: {subjectHint}</p>
                )}
              </>
            )}
          </div>

          {/* who */}
          <aside className="hidden min-h-0 overflow-y-auto border-l border-[#EEF1F6] p-4 xl:block">
            {c ? (
              <>
                <div className="flex flex-col items-center text-center">
                  <Avatar name={name} channel={c.channel} size={56} />
                  <b className="mt-2 text-[14px]">{name}</b>
                  {open.contact ? (
                    <span className="mt-1 text-[12px] text-ink-500">Member #{open.contact.member_no}</span>
                  ) : (
                    <span className="mt-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-ink-500">
                      Not a member
                    </span>
                  )}
                </div>
                {open.contact &&
                  (() => {
                    const k = open.contact;
                    const active = k.ends && k.ends.getTime() > Date.now();
                    const days = k.ends ? Math.ceil((k.ends.getTime() - Date.now()) / 86400_000) : null;
                    return (
                      <>
                        <div
                          className={`mt-4 rounded-xl px-3 py-2.5 text-[12.5px] ${active ? (days !== null && days <= 7 ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800') : 'bg-rose-50 text-rose-800'}`}
                        >
                          <b className="block">
                            {active
                              ? days !== null && days <= 7
                                ? `Ends in ${days} day${days === 1 ? '' : 's'}`
                                : 'Active'
                              : k.ends
                                ? 'Lapsed'
                                : 'Never paid'}
                          </b>
                          {k.ends && (
                            <span>
                              {active ? 'until' : 'ended'} {date(k.ends)}
                              {k.plan ? ` · ${k.plan}` : ''}
                            </span>
                          )}
                        </div>
                        <dl className="mt-4 space-y-2.5 text-[12.5px]">
                          {k.phone && (
                            <div className="flex justify-between gap-3">
                              <dt className="text-ink-500">Phone</dt>
                              <dd className="truncate">{k.phone}</dd>
                            </div>
                          )}
                          {k.email && (
                            <div className="flex justify-between gap-3">
                              <dt className="text-ink-500">Email</dt>
                              <dd className="truncate">{k.email}</dd>
                            </div>
                          )}
                          <div className="flex justify-between gap-3">
                            <dt className="text-ink-500">Last visit</dt>
                            <dd>{k.last_visit ? ago(k.last_visit) : 'never'}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-ink-500">Paid in total</dt>
                            <dd className="tabular-nums">{kes(k.paid_total)}</dd>
                          </div>
                        </dl>
                        <div className="mt-4 grid gap-2">
                          {can(s, 'payments.record') && (
                            <Link href={`/members/${k.id}#pay`} className="btn-primary py-2 text-[12.5px]">
                              Send M-Pesa prompt
                            </Link>
                          )}
                          <Link href={`/members/${k.id}`} className="btn-ghost py-2 text-[12.5px]">
                            <ExternalLink size={13} /> Open member
                          </Link>
                        </div>
                      </>
                    );
                  })()}
                {!open.contact && (
                  <p className="mt-4 text-[12.5px] text-ink-500">
                    {pretty(c.channel, c.address)} isn’t on a member’s record. If they join, add this{' '}
                    {c.channel === 'email' ? 'email' : 'number'} to their member page and the conversation links up.
                  </p>
                )}
              </>
            ) : (
              <p className="pt-10 text-center text-[12px] text-ink-300">Who you’re talking to shows here.</p>
            )}
          </aside>
        </section>
      )}
    </>
  );
}
