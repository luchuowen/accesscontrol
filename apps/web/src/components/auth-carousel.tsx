'use client';
import { useEffect, useState } from 'react';

const STAFF = [
  {
    eyebrow: 'MEMBERSHIP + ACCESS',
    title: 'Instant door access',
    body: 'M-Pesa payments activate access within seconds, so members can enter without waiting at the gate for payment confirmation.',
    icon: 'door',
  },
  {
    eyebrow: 'PAYMENTS',
    title: 'Payments auto-match',
    body: 'The payment gateway links each payment to the correct member and sends a receipt by SMS and email.',
    icon: 'receipt',
  },
  {
    eyebrow: 'RELIABLE ACCESS',
    title: 'Access works offline',
    body: 'If the internet goes down, members can still enter. Any changes made at the door are saved and updated when the connection returns.',
    icon: 'shield',
  },
] as const;

/** For members on the portal: their own access, renewing, and receipts (approved 2 Oct). */
const MEMBERS = [
  {
    eyebrow: 'YOUR ACCESS',
    title: 'See your days left',
    body: 'Check which areas you can use and when your membership ends.',
    icon: 'door',
  },
  {
    eyebrow: 'M-PESA',
    title: 'Renew in seconds',
    body: 'Pay with M-Pesa from your phone and your access updates right away.',
    icon: 'receipt',
  },
  {
    eyebrow: 'RECEIPTS',
    title: 'Instant SMS receipts',
    body: 'You get an SMS receipt for every payment you make.',
    icon: 'shield',
  },
] as const;

type Slide = (typeof STAFF)[number] | (typeof MEMBERS)[number];

function Icon({ kind }: { kind: Slide['icon'] }) {
  const p = {
    width: 52,
    height: 52,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: '#34D399',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (kind === 'door')
    return (
      <svg {...p}>
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <path d="M15 12h.01" />
        <path d="M9 7l2 2 4-4" />
      </svg>
    );
  if (kind === 'receipt')
    return (
      <svg {...p}>
        <path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2z" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </svg>
    );
  return (
    <svg {...p}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

/** The three things Lango does, turning every 6 seconds (paused on hover, and still for reduced motion). */
export function AuthCarousel({ audience = 'staff' }: { audience?: 'staff' | 'members' }) {
  const SLIDES: readonly Slide[] = audience === 'members' ? MEMBERS : STAFF;
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % SLIDES.length), 6000);
    return () => clearInterval(t);
  }, [paused]);
  const s = (SLIDES[i] ?? SLIDES[0]) as Slide;
  return (
    <div
      className="flex flex-col items-center text-center"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="grid h-[120px] w-[120px] place-items-center rounded-3xl border border-white/10 bg-white/[0.06]">
        <Icon kind={s.icon} />
      </div>
      <div key={i} className="auth-fade mt-7 min-h-[150px]" aria-live="polite">
        <div className="text-[11px] font-semibold tracking-[0.14em] text-[#34D399]">{s.eyebrow}</div>
        <div className="mt-2.5 text-2xl font-semibold tracking-tight">{s.title}</div>
        <p className="mx-auto mt-2.5 max-w-[340px] text-sm leading-relaxed text-[#AAB6C8]">{s.body}</p>
      </div>
      <div className="mt-4 flex gap-1.5">
        {SLIDES.map((x, n) => (
          <button
            key={x.title}
            type="button"
            aria-label={`Show: ${x.title}`}
            aria-current={n === i}
            onClick={() => setI(n)}
            className={`h-1.5 rounded-full transition-all ${n === i ? 'w-[22px] bg-[#34D399]' : 'w-1.5 bg-white/30 hover:bg-white/50'}`}
          />
        ))}
      </div>
    </div>
  );
}
