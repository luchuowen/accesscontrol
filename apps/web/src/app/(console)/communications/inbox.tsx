'use client';

import { Megaphone, MessageSquarePlus, Search, Send, Sparkles, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { findPeople, type Person, type ReplyState, reply, startConversation } from './actions';
import { AnnounceForm, units } from './announce-form';

/** Refresh the inbox every 15 s while the tab is visible (new WhatsApp and email messages). */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 15_000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}

/** Keeps the thread scrolled to the newest message. */
export function ScrollEnd({ dep }: { dep: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'end' });
  }, [dep]);
  return <div ref={ref} />;
}

/** Search and filters above the list; the URL holds them so a refresh keeps the view. */
export function ListFilters() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [pending, start] = useTransition();
  const go = (patch: Record<string, string>) => {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) v ? u.set(k, v) : u.delete(k);
    u.delete('m');
    start(() => router.replace(`${path}?${u}`, { scroll: false }));
  };
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => go({ q: q.trim() }), 250);
    return () => clearTimeout(t);
  }, [q]);
  const ch = sp.get('ch') ?? '';
  const chip = (v: string, l: string) => (
    <button
      key={v}
      type="button"
      onClick={() => go({ ch: v })}
      className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition ${ch === v ? 'bg-ink-900 text-white' : 'bg-[#F2F4F8] text-ink-500 hover:text-ink-900'}`}
    >
      {l}
    </button>
  );
  return (
    <div className={`space-y-2.5 border-b border-[#EEF1F6] p-3 ${pending ? 'opacity-70' : ''}`}>
      <div className="flex gap-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#E5E8EE] bg-[#FAFBFC] px-2.5 text-ink-300 focus-within:border-slate-300">
          <Search size={14} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, number, phone…"
            aria-label="Search conversations"
            className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-ink-900 outline-none placeholder:text-ink-300"
          />
        </label>
        <select
          aria-label="Show"
          value={sp.get('f') ?? 'all'}
          onChange={(e) => go({ f: e.target.value === 'all' ? '' : e.target.value })}
          className="h-9 shrink-0 rounded-lg border border-[#E5E8EE] bg-white px-1.5 text-[12px] text-ink-700 outline-none"
        >
          <option value="all">Open</option>
          <option value="unread">Unread</option>
          <option value="waiting">Waiting for us</option>
          <option value="done">Done</option>
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        {chip('', 'All')}
        {chip('whatsapp', 'WhatsApp')}
        {chip('sms', 'SMS')}
        {chip('email', 'Email')}
      </div>
    </div>
  );
}

/** Reply box: Enter sends, Shift+Enter is a new line. Quick replies fill in common answers. */
export function Composer({
  id,
  channel,
  blocked,
  quick,
  member,
}: {
  id: string;
  channel: 'sms' | 'whatsapp' | 'email';
  blocked?: string;
  quick: { label: string; text: string }[];
  member: boolean;
}) {
  const [state, action] = useActionState<ReplyState, FormData>(reply, {});
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [open, setOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.sent) setBody('');
  }, [state.sent]);
  if (blocked)
    return <div className="border-t border-[#EEF1F6] bg-[#FAFBFC] px-4 py-3 text-[12.5px] text-ink-500">{blocked}</div>;
  const u = channel === 'sms' && body.trim() ? units(body.trim()) : 0;
  return (
    <form ref={form} action={action} className="relative border-t border-[#EEF1F6] p-3">
      <input type="hidden" name="conversationId" value={id} />
      {state.error && <p className="mb-2 px-1 text-[12px] text-rose-700">{state.error}</p>}
      {channel === 'email' && (
        <input
          name="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          aria-label="Subject"
          className="mb-2 h-9 w-full rounded-lg border border-[#E5E8EE] px-3 text-[13px] outline-none focus:border-slate-300"
        />
      )}
      {open && (
        <div className="absolute bottom-full left-3 z-20 mb-2 w-80 rounded-xl border border-[#E7EBF3] bg-white p-1.5 shadow-lg">
          <div className="flex items-center px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">
            Quick replies
            <button type="button" onClick={() => setOpen(false)} className="ml-auto text-ink-300 hover:text-ink-900">
              <X size={14} />
            </button>
          </div>
          {quick.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => {
                setBody(t.text);
                setOpen(false);
              }}
              className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-slate-50"
            >
              <b className="block text-[12.5px]">{t.label}</b>
              <span className="line-clamp-2 text-[11.5px] text-ink-500">{t.text}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-xl border border-[#E5E8EE] bg-white p-1.5 focus-within:border-slate-300">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          title="Quick replies"
          aria-label="Quick replies"
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${open ? 'bg-slate-100 text-ink-900' : 'text-ink-300 hover:bg-slate-50 hover:text-ink-900'}`}
        >
          <Sparkles size={16} />
        </button>
        <textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (body.trim()) form.current?.requestSubmit();
            }
          }}
          rows={Math.min(6, Math.max(1, body.split('\n').length))}
          maxLength={channel === 'sms' ? 480 : 4000}
          placeholder={`Reply by ${channel === 'sms' ? 'SMS' : channel === 'whatsapp' ? 'WhatsApp' : 'email'}${member ? '' : ''}…`}
          aria-label="Message"
          className="max-h-40 min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-[13.5px] outline-none placeholder:text-ink-300"
        />
        <SubmitButton pendingText="" className="btn-primary h-8 shrink-0 px-3 py-0 text-[12.5px]">
          <Send size={14} /> Send
        </SubmitButton>
      </div>
      <div className="mt-1.5 flex px-1 text-[11px] text-ink-300">
        Enter to send · Shift+Enter for a new line
        {channel === 'sms' && body.trim() && (
          <span className={`ml-auto ${u > 1 ? 'text-amber-700' : ''}`}>
            {body.trim().length} characters · {u} SMS
          </span>
        )}
      </div>
    </form>
  );
}

/** New message: pick a member (or type a phone / email), pick the channel, then write in the thread. */
export function NewMessage({ channels }: { channels: { key: 'sms' | 'whatsapp' | 'email'; label: string }[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Person[]>([]);
  const [who, setWho] = useState<Person | null>(null);
  const [ch, setCh] = useState(channels[0]?.key ?? 'sms');
  useEffect(() => {
    if (who || q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => findPeople(q).then(setHits), 200);
    return () => clearTimeout(t);
  }, [q, who]);
  const missing = who && (ch === 'email' ? !who.email : !who.phone);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        disabled={!channels.length}
        className="btn-primary disabled:opacity-50"
      >
        <MessageSquarePlus size={15} /> New message
      </button>
      <dialog
        ref={ref}
        className="m-auto w-[min(440px,calc(100vw-32px))] rounded-2xl p-0 shadow-xl backdrop:bg-ink-950/40"
      >
        <form action={startConversation} className="p-5">
          <div className="mb-4 flex items-center">
            <h2 className="text-[15px] font-semibold">New message</h2>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Close"
              className="ml-auto text-ink-300 hover:text-ink-900"
            >
              <X size={18} />
            </button>
          </div>
          <span className="label">Send by</span>
          <div className="mt-1.5 mb-4 grid grid-cols-3 gap-2">
            {channels.map((c) => (
              <label
                key={c.key}
                className={`cursor-pointer rounded-xl border px-3 py-2 text-center text-[13px] font-medium ${ch === c.key ? 'border-ink-900 bg-ink-900 text-white' : 'border-[#E5E8EE] hover:border-slate-300'}`}
              >
                <input
                  type="radio"
                  name="channel"
                  value={c.key}
                  checked={ch === c.key}
                  onChange={() => setCh(c.key)}
                  className="sr-only"
                />
                {c.label}
              </label>
            ))}
          </div>
          <span className="label">To</span>
          {who ? (
            <div className="mt-1.5 flex items-center gap-3 rounded-xl bg-[#F6F8FB] px-3 py-2.5">
              <input type="hidden" name="memberId" value={who.id} />
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[13px]">{who.name}</b>
                <span className="text-[12px] text-ink-500">
                  #{who.no} · {(ch === 'email' ? who.email : who.phone) ?? `no ${ch === 'email' ? 'email' : 'phone'}`}
                </span>
              </div>
              <button type="button" onClick={() => setWho(null)} className="text-[12px] font-medium text-ink-500">
                Change
              </button>
            </div>
          ) : (
            <div className="relative mt-1.5">
              <input
                name="address"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={ch === 'email' ? 'Member name, or an email address' : 'Member name or no., or a phone 07…'}
                autoComplete="off"
                className="input"
              />
              {hits.length > 0 && (
                <ul className="absolute inset-x-0 top-full z-10 mt-1 rounded-xl border border-[#E7EBF3] bg-white p-1 shadow-lg">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => setWho(h)}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-slate-50"
                      >
                        <b className="truncate">{h.name}</b>
                        <span className="text-[12px] text-ink-500">#{h.no}</span>
                        <span className="ml-auto text-[12px] text-ink-500">{h.phone}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {missing && (
            <p className="mt-2 text-[12px] text-amber-700">
              No {ch === 'email' ? 'email address' : 'phone number'} for this member. Add it on their page first.
            </p>
          )}
          {ch === 'whatsapp' && (
            <p className="mt-3 text-[12px] text-ink-500">
              WhatsApp lets the club reply within 24 hours of the person’s last message. To reach someone first, use
              SMS.
            </p>
          )}
          <SubmitButton pendingText="Opening…" className="btn-primary mt-5 w-full" disabled={!!missing}>
            Open conversation
          </SubmitButton>
        </form>
      </dialog>
    </>
  );
}

/** Club news to many members by SMS (owner or manager), with the cost shown before anything is sent. */
export function NewsDialog({ club, open, audience }: { club: string; open?: boolean; audience?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className="btn-ghost">
        <Megaphone size={15} /> Send news
      </button>
      <dialog
        ref={ref}
        className="m-auto w-[min(520px,calc(100vw-32px))] rounded-2xl p-0 shadow-xl backdrop:bg-ink-950/40"
      >
        <div className="p-5">
          <div className="flex items-center">
            <div>
              <h2 className="text-[15px] font-semibold">Send news to members</h2>
              <p className="text-[12px] text-ink-500">By SMS. Closures, events, new classes, offers.</p>
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Close"
              className="ml-auto text-ink-300 hover:text-ink-900"
            >
              <X size={18} />
            </button>
          </div>
          <AnnounceForm club={club} initialAudience={audience} />
          <p className="mt-4 text-[11.5px] text-ink-500">
            Members who turned off club news in their portal are left out. Receipts and reminders still reach them.
          </p>
        </div>
      </dialog>
    </>
  );
}
