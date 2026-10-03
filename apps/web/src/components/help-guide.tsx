'use client';
import {
  ArrowRight,
  BarChart3,
  Check,
  CircleHelp,
  Copy,
  CreditCard,
  Download,
  IdCard,
  Layers,
  Mail,
  Megaphone,
  MessageSquarePlus,
  MessagesSquare,
  Rocket,
  Search,
  Send,
  Smartphone,
  Ticket,
  UserPlus,
  UsersRound,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Help, design A "Step by step" (approved 3 Oct 2026): a quick guide for each everyday task, all steps on one
 * screen (no paging), each step showing where and the button to press. Only guides the signed-in person's role can do are listed; it opens on
 * the guide for the page they are on.
 */
type Icon = typeof Rocket;
type Step = { title: string; text: string; where: string; button?: { icon: Icon; label: string } };
type Guide = {
  key: string;
  title: string;
  blurb: string;
  icon: Icon;
  tone: keyof typeof TONE;
  perm: string | null;
  page: string;
  href: string;
  steps: Step[];
};

const TONE = {
  emerald: {
    tile: 'bg-emerald-500',
    soft: 'bg-emerald-50 text-emerald-700',
    band: 'from-emerald-600 to-emerald-800',
    dot: 'bg-emerald-500',
  },
  sky: { tile: 'bg-sky-500', soft: 'bg-sky-50 text-sky-700', band: 'from-sky-600 to-sky-800', dot: 'bg-sky-500' },
  amber: {
    tile: 'bg-amber-500',
    soft: 'bg-amber-50 text-amber-700',
    band: 'from-amber-500 to-orange-700',
    dot: 'bg-amber-500',
  },
  violet: {
    tile: 'bg-violet-500',
    soft: 'bg-violet-50 text-violet-700',
    band: 'from-violet-600 to-violet-800',
    dot: 'bg-violet-500',
  },
  rose: {
    tile: 'bg-rose-500',
    soft: 'bg-rose-50 text-rose-700',
    band: 'from-rose-500 to-rose-700',
    dot: 'bg-rose-500',
  },
  teal: {
    tile: 'bg-teal-500',
    soft: 'bg-teal-50 text-teal-700',
    band: 'from-teal-600 to-teal-800',
    dot: 'bg-teal-500',
  },
  indigo: {
    tile: 'bg-indigo-500',
    soft: 'bg-indigo-50 text-indigo-700',
    band: 'from-indigo-600 to-indigo-800',
    dot: 'bg-indigo-500',
  },
  slate: {
    tile: 'bg-slate-700',
    soft: 'bg-slate-100 text-slate-700',
    band: 'from-slate-700 to-slate-900',
    dot: 'bg-slate-600',
  },
} as const;

const GUIDES: Guide[] = [
  {
    key: 'setup',
    title: 'Getting set up',
    blurb: 'From a new club to taking payments',
    icon: Rocket,
    tone: 'slate',
    perm: 'settings.payments',
    page: 'Settings',
    href: '/settings',
    steps: [
      {
        title: 'Follow the checklist',
        text: 'Settings › Club shows each setup step, what is done and what is left.',
        where: 'Settings',
        button: { icon: Check, label: 'Club setup' },
      },
      {
        title: 'Check how members pay',
        text: 'NAVAC connects your M-Pesa paybill or till during onboarding. Settings › Payments shows what is set up.',
        where: 'Settings › Payments',
      },
      {
        title: 'Add what you sell',
        text: 'Pick your services from the list (Gym, Pool, Sauna…) and enter the prices. Members can then pay for them.',
        where: 'Services',
        button: { icon: Layers, label: 'Add service' },
      },
      {
        title: 'Your installer connects the doors',
        text: 'They install the door PC and link each reader to an area. The bell tells you when it is online.',
        where: 'Doors & access',
      },
    ],
  },
  {
    key: 'member',
    title: 'Add a member',
    blurb: 'Register someone new in a minute',
    icon: UserPlus,
    tone: 'emerald',
    perm: 'members.edit',
    page: 'Members',
    href: '/members',
    steps: [
      {
        title: 'Open Members',
        text: 'Go to Members in the left menu and press Add member.',
        where: 'Members',
        button: { icon: UserPlus, label: 'Add member' },
      },
      {
        title: 'Enter their details',
        text: 'First and last name and a Kenyan mobile number. The member number is filled in for you.',
        where: 'Add member form',
      },
      {
        title: 'Link their card or wristband',
        text: 'Type the number printed on the card and press Link. The doors know it within a minute.',
        where: 'Member page › Cards & wristbands',
        button: { icon: IdCard, label: 'Link' },
      },
      {
        title: 'Take the first payment',
        text: 'Send an M-Pesa prompt or record cash. Access starts as soon as the payment is confirmed.',
        where: 'Member page',
        button: { icon: Smartphone, label: 'Send M-Pesa prompt' },
      },
    ],
  },
  {
    key: 'pay',
    title: 'Take a payment',
    blurb: 'M-Pesa prompt or cash at the desk',
    icon: Wallet,
    tone: 'sky',
    perm: 'payments.record',
    page: 'Payments',
    href: '/payments',
    steps: [
      {
        title: 'Find the member',
        text: 'On Payments, press Send M-Pesa prompt and search by name, member number or phone.',
        where: 'Payments',
        button: { icon: Smartphone, label: 'Send M-Pesa prompt' },
      },
      {
        title: 'Pick the plan',
        text: 'Choose what they are paying for. The price comes from Services, so you never type it.',
        where: 'Member page',
        button: { icon: Send, label: 'Send prompt to phone' },
      },
      {
        title: 'They enter their PIN',
        text: 'A prompt pops up on their phone. Once they pay, the receipt goes out by SMS and the doors update.',
        where: 'Their phone',
      },
      {
        title: 'Paid in cash?',
        text: 'Press Record cash instead, choose the plan and save. It shows in the ledger with your name.',
        where: 'Payments',
        button: { icon: Wallet, label: 'Record cash' },
      },
    ],
  },
  {
    key: 'match',
    title: 'Match a payment',
    blurb: 'Money in, but no member matched',
    icon: CreditCard,
    tone: 'amber',
    perm: 'payments.assign',
    page: 'Payments',
    href: '/payments#sort',
    steps: [
      {
        title: 'Look for the amber bar',
        text: 'On Payments, “payments need you” means money came in with an account number that matched no member.',
        where: 'Payments',
      },
      {
        title: 'Press Sort them',
        text: 'You see each amount, the time, what they typed and their phone number.',
        where: 'Payments',
        button: { icon: CreditCard, label: 'Sort them' },
      },
      {
        title: 'Point it at the member',
        text: 'Type the right member number, pick the service and press Apply. Their access updates straight away.',
        where: 'Payments to sort',
        button: { icon: Check, label: 'Apply' },
      },
    ],
  },
  {
    key: 'walkin',
    title: 'Sell a day pass',
    blurb: 'Walk-ins on a wristband',
    icon: Ticket,
    tone: 'teal',
    perm: 'payments.record',
    page: 'Dashboard',
    href: '/',
    steps: [
      {
        title: 'Press Walk-in',
        text: 'On the Dashboard or Members, press Walk-in and hand the visitor a wristband.',
        where: 'Dashboard',
        button: { icon: Ticket, label: 'Walk-in' },
      },
      {
        title: 'Choose what they want',
        text: 'Tick the services, for example gym and steam. The total adds up for you.',
        where: 'Walk-in window',
      },
      {
        title: 'Take the money',
        text: 'Send an M-Pesa prompt to their phone, or take cash. The wristband opens those doors for the day.',
        where: 'Walk-in window',
      },
    ],
  },
  {
    key: 'card',
    title: 'Link or replace a card',
    blurb: 'Cards, tags and wristbands',
    icon: IdCard,
    tone: 'indigo',
    perm: 'members.edit',
    page: 'Members',
    href: '/members',
    steps: [
      {
        title: 'Open the member',
        text: 'Use the search in the top bar, or find them on Members, and open their page.',
        where: 'Top bar',
        button: { icon: Search, label: 'Search' },
      },
      {
        title: 'Enter the card number',
        text: 'Under Cards & wristbands, type the number printed on the card (1 to 65535) and press Link.',
        where: 'Member page',
        button: { icon: IdCard, label: 'Link' },
      },
      {
        title: 'Test it at the door',
        text: 'Give it a minute, then tap the card. A lost card stops working as soon as you link the new one.',
        where: 'At the door',
      },
    ],
  },
  {
    key: 'msgs',
    title: 'Answer messages',
    blurb: 'SMS, WhatsApp and email in one place',
    icon: MessagesSquare,
    tone: 'violet',
    perm: 'inbox.reply',
    page: 'Communications',
    href: '/communications',
    steps: [
      {
        title: 'Open Communications',
        text: 'Conversations with an amber dot are waiting for you. The bell tells you too.',
        where: 'Communications',
      },
      {
        title: 'See who it is',
        text: 'The panel on the right shows if they are a member, when their plan ends and when they last came in.',
        where: 'Conversation',
      },
      {
        title: 'Reply and press Enter',
        text: 'Quick replies fill in payment details for you. Press Done when the conversation is finished.',
        where: 'Conversation',
        button: { icon: Send, label: 'Send' },
      },
      {
        title: 'Start a new one',
        text: 'New message lets you write to any member by SMS, WhatsApp or email.',
        where: 'Communications',
        button: { icon: MessageSquarePlus, label: 'New message' },
      },
    ],
  },
  {
    key: 'news',
    title: 'Send club news',
    blurb: 'One SMS to many members',
    icon: Megaphone,
    tone: 'rose',
    perm: 'messages.manage',
    page: 'Communications',
    href: '/communications?news=current',
    steps: [
      {
        title: 'Press Send news',
        text: 'On Communications, choose who gets it: members with access now, recently lapsed, or everyone.',
        where: 'Communications',
        button: { icon: Megaphone, label: 'Send news' },
      },
      {
        title: 'Write it short',
        text: 'The club name is added at the start, and you see how many SMS it uses as you type.',
        where: 'Send news window',
      },
      {
        title: 'Check the cost, then send',
        text: 'You see how many people get it and what it costs before anything goes out.',
        where: 'Send news window',
      },
    ],
  },
  {
    key: 'reports',
    title: 'Reports and exports',
    blurb: 'Numbers for you and your accountant',
    icon: BarChart3,
    tone: 'sky',
    perm: 'reports.all',
    page: 'Reports',
    href: '/reports',
    steps: [
      {
        title: 'Pick the period',
        text: 'On Reports, choose the last 7, 30 or 90 days, or the last 12 months.',
        where: 'Reports',
      },
      {
        title: 'Read the four numbers',
        text: 'Money in, active members, renewal rate and visits, each against the period before.',
        where: 'Reports',
      },
      {
        title: 'Export',
        text: 'Every section has Export for Excel, CSV or PDF. Export all gives one file with everything.',
        where: 'Reports',
        button: { icon: Download, label: 'Export all' },
      },
    ],
  },
  {
    key: 'team',
    title: 'Team and roles',
    blurb: 'Who can sign in, and what they may do',
    icon: UsersRound,
    tone: 'emerald',
    perm: 'team.manage',
    page: 'Settings',
    href: '/settings?tab=team',
    steps: [
      {
        title: 'Open Team & roles',
        text: 'In Settings, open Team & roles and fill in Invite someone.',
        where: 'Settings › Team & roles',
      },
      {
        title: 'Choose the right role',
        text: 'Front desk adds members and takes payments. Managers run the club day to day. Accountants see money and reports.',
        where: 'Invite form',
      },
      {
        title: 'Send the invitation',
        text: 'They get an email to set their own password. Remove someone at any time and they are signed out at once.',
        where: 'Invite form',
        button: { icon: Mail, label: 'Send invitation' },
      },
    ],
  },
];

const PAGE_OF = (path: string) =>
  path === '/'
    ? 'Dashboard'
    : (['Members', 'Services', 'Payments', 'Reports', 'Communications', 'Settings'].find((p) =>
        path.startsWith(`/${p.toLowerCase()}`),
      ) ?? '');

export function HelpGuide({ perms }: { perms: string[] }) {
  const path = usePathname();
  const guides = GUIDES.filter((g) => !g.perm || perms.includes(g.perm));
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(guides[0]?.key ?? '');
  const [copied, setCopied] = useState(false);
  const g = guides.find((x) => x.key === key) ?? guides[0];
  const show = () => {
    const here = guides.find((x) => x.page === PAGE_OF(path));
    setKey((here ?? guides[0])?.key ?? '');
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const keys = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [open]);
  if (!g) return null;
  const t = TONE[g.tone];
  const GI = g.icon;
  return (
    <>
      <button
        type="button"
        aria-label="Help"
        onClick={show}
        className="grid h-9 w-9 place-items-center rounded-full text-ink-700 transition hover:bg-slate-100"
      >
        <CircleHelp size={19} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 print:hidden">
          <button
            type="button"
            aria-label="Close help"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-ink-950/40 backdrop-blur-[2px] animate-[fadein_.15s_ease-out]"
          />
          <div
            role="dialog"
            aria-label="Help"
            className="relative grid h-[min(640px,calc(100vh-32px))] w-[min(880px,100%)] overflow-hidden rounded-3xl bg-white shadow-[0_40px_80px_-30px_rgba(11,22,41,0.55)] md:grid-cols-[260px_1fr]"
          >
            {/* guides */}
            <nav className="flex min-h-0 gap-1 overflow-x-auto border-b border-[#EEF1F6] bg-[#F7F8FA] p-3 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
              <div className="hidden px-2 pb-2 pt-1 md:block">
                <b className="block text-[15px]">Help</b>
                <span className="text-[12px] text-ink-500">Quick guides for everyday work</span>
              </div>
              {guides.map((x) => {
                const XI = x.icon;
                const on = x.key === g.key;
                return (
                  <button
                    key={x.key}
                    type="button"
                    onClick={() => setKey(x.key)}
                    className={`flex shrink-0 items-center gap-2.5 rounded-xl px-2 py-2 text-left transition ${on ? 'bg-white shadow-[0_1px_3px_rgba(11,22,41,0.1)] ring-1 ring-[#E7EBF3]' : 'hover:bg-white/70'}`}
                  >
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-white ${TONE[x.tone].tile}`}
                    >
                      <XI size={16} />
                    </span>
                    <span className="min-w-0">
                      <b className={`block truncate text-[13px] ${on ? 'text-ink-900' : 'font-semibold text-ink-700'}`}>
                        {x.title}
                      </b>
                      <span className="hidden truncate text-[11.5px] text-ink-500 md:block">{x.blurb}</span>
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* all steps of the chosen guide, on one screen */}
            <section className="flex min-h-0 min-w-0 flex-col">
              <header className={`relative overflow-hidden bg-gradient-to-br ${t.band} px-6 py-5 text-white`}>
                <GI
                  size={110}
                  strokeWidth={1.2}
                  className="pointer-events-none absolute -right-5 -top-6 opacity-[0.12]"
                />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"
                >
                  <X size={16} />
                </button>
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25">
                    <GI size={22} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[19px] font-semibold tracking-tight">{g.title}</h2>
                    <p className="text-[12.5px] text-white/75">
                      {g.steps.length} steps · about a minute · {g.page}
                    </p>
                  </div>
                </div>
              </header>

              <ol key={g.key} className="flex-1 overflow-y-auto px-6 py-5 animate-[slidein_.18s_ease-out]">
                {g.steps.map((s, i) => {
                  const BI = s.button?.icon;
                  const end = i === g.steps.length - 1;
                  return (
                    <li key={s.title} className="relative flex gap-4 pb-5 last:pb-0">
                      {!end && <span className="absolute bottom-0 left-[17px] top-10 w-px bg-[#E7EBF3]" />}
                      <span
                        className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-[14px] font-bold ${t.soft}`}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1 pt-1.5">
                        <h3 className="text-[15px] font-semibold leading-snug tracking-tight">{s.title}</h3>
                        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-700">{s.text}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F4F6F9] px-2.5 py-1 font-medium text-ink-700">
                            <i className={`h-1.5 w-1.5 rounded-full ${t.dot}`} /> {s.where}
                          </span>
                          {s.button && BI && (
                            <>
                              <ArrowRight size={13} className="text-ink-300" />
                              <span className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-2.5 py-1 font-semibold text-white">
                                <BI size={13} /> {s.button.label}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>

              <footer className="flex flex-wrap items-center gap-2 border-t border-[#EEF1F6] px-6 py-3.5">
                <span className="mr-auto inline-flex items-center gap-1.5 text-[12px] text-ink-500">
                  Still stuck?
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard
                        ?.writeText('support@navac.co.ke')
                        .then(() => setCopied(true))
                        .catch(() => {});
                    }}
                    className="inline-flex items-center gap-1 font-semibold text-ink-900 hover:underline"
                  >
                    support@navac.co.ke {copied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </span>
                <Link href={g.href} onClick={() => setOpen(false)} className="btn-primary px-4 py-2 text-[13px]">
                  Go to {g.page} <ArrowRight size={15} />
                </Link>
              </footer>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
