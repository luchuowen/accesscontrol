'use client';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Ticks once a second; returns milliseconds left until `at`. */
function useLeft(at: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, at - now);
}

/** Countdown ring: how long the code still works. */
export function CodeTimer({ expiresAt, totalMs = 10 * 60_000 }: { expiresAt: number; totalMs?: number }) {
  const left = useLeft(expiresAt);
  const c = 2 * Math.PI * 32;
  const done = left === 0;
  return (
    <div className="relative mx-auto mb-4 grid h-[72px] w-[72px] place-items-center" role="timer" aria-live="off">
      <svg viewBox="0 0 72 72" className="absolute inset-0" aria-hidden="true">
        <circle cx="36" cy="36" r="32" fill="none" stroke="#E2E8F0" strokeWidth="4" />
        <circle
          cx="36"
          cy="36"
          r="32"
          fill="none"
          stroke={done ? '#E11D48' : '#10B981'}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, left / totalMs))}
          transform="rotate(-90 36 36)"
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <span className={`font-semibold ${done ? 'text-[11px] text-rose-600' : 'font-mono text-[15px] text-ink-900'}`}>
        {done ? 'Expired' : fmt(left)}
      </span>
    </div>
  );
}

/** Six boxes for the code, 3 + 3. Typing moves on, backspace moves back, a pasted code fills them all. */
export function OtpInput() {
  const { pending } = useFormStatus();
  const [d, setD] = useState<string[]>(['', '', '', '', '', '']);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const code = d.join('');
  useEffect(() => {
    if (code.length === 6) refs.current[5]?.form?.requestSubmit();
  }, [code]);
  const fill = (from: number, digits: string) => {
    const next = [...d];
    let i = from;
    for (const ch of digits.replace(/\D/g, '').slice(0, 6 - from)) next[i++] = ch;
    setD(next);
    refs.current[Math.min(i, 5)]?.focus();
  };
  return (
    <fieldset className="mt-6 flex items-center justify-center gap-2 sm:gap-2.5">
      <legend className="sr-only">Sign-in code</legend>
      <input type="hidden" name="code" value={code} />
      {d.map((v, i) => (
        <span key={`box-${i}`} className="contents">
          {i === 3 && (
            <span className="w-3 text-center text-slate-400" aria-hidden="true">
              –
            </span>
          )}
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={v}
            aria-label={`Digit ${i + 1}`}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            autoFocus={i === 0}
            maxLength={i === 0 ? 6 : 1}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '');
              if (!v) return setD(d.map((x, k) => (k === i ? '' : x)));
              fill(i, i > 0 ? v.slice(-1) : v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !d[i] && i > 0) refs.current[i - 1]?.focus();
              if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
              if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
            }}
            onPaste={(e) => {
              e.preventDefault();
              fill(0, e.clipboardData.getData('text'));
            }}
            onFocus={(e) => e.target.select()}
            disabled={pending}
            className={`h-14 w-11 rounded-xl border bg-white text-center font-mono text-[22px] font-semibold text-ink-900 outline-none transition sm:w-12 ${v ? 'border-brand-500 ring-[3px] ring-brand-500/15' : 'border-slate-200'} focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15`}
          />
        </span>
      ))}
      <span className="sr-only" aria-live="polite">
        {pending ? 'Checking your code' : ''}
      </span>
    </fieldset>
  );
}

/** Shown under the boxes while the code is being checked. */
export function Checking() {
  const { pending } = useFormStatus();
  return (
    <p
      className={`mt-4 flex h-5 items-center justify-center gap-2 text-sm text-slate-500 ${pending ? '' : 'invisible'}`}
    >
      <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Checking your code…
    </p>
  );
}

/** "Resend SMS" stays disabled, with a countdown, until the resend policy allows another code. */
export function ResendButton({ resendAt, label }: { resendAt: number; label: string }) {
  const left = useLeft(resendAt);
  return left > 0 ? (
    <span className="text-slate-400" aria-live="polite">
      {label} in {fmt(left)}
    </span>
  ) : (
    <button type="submit" className="auth-link">
      {label}
    </button>
  );
}
