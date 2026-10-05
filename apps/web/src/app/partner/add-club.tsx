'use client';
import { Check, Copy, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { type CreateClubState, createClub } from './actions';

type Partner = { id: string; name: string };
const ZONES = [
  ['Africa/Nairobi', 'East Africa time', 'Nairobi'],
  ['Africa/Kampala', 'East Africa time', 'Kampala'],
  ['Africa/Dar_es_Salaam', 'East Africa time', 'Dar es Salaam'],
  ['Africa/Kigali', 'Central Africa time', 'Kigali'],
] as const;
// Same rule as the server: the server also adds -2, -3… when a code is taken.
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'club';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^(\+?254|0)?\s*[17](\s*\d){8}$/;

/**
 * “+ Add a club” in the partner console. Opens a popup that asks one thing at a time (design B): the club, then who runs
 * it, then the result with the NAVAC Bridge pairing code. Partner admins only; NAVAC also picks the partner.
 */
export function AddClubButton({
  consoleUrl,
  partners = [],
  variant = 'primary',
  autoOpen = false,
}: {
  consoleUrl: string;
  partners?: Partner[];
  variant?: 'primary' | 'light';
  autoOpen?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [run, setRun] = useState(0); // a new run starts the form afresh
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const show = () => {
    setOpen(true);
    ref.current?.showModal();
  };
  useEffect(() => {
    if (autoOpen) show();
  }, [autoOpen]);
  const onClose = () => {
    setOpen(false);
    setRun((r) => r + 1);
    router.refresh(); // a new club shows in the list behind
  };
  return (
    <>
      <button
        type="button"
        onClick={show}
        className={
          variant === 'light'
            ? 'inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-[13px] font-semibold text-ink-950 hover:bg-slate-100'
            : 'btn-primary'
        }
      >
        <Plus size={variant === 'light' ? 15 : 16} /> Add a club
      </button>
      <dialog
        ref={ref}
        aria-labelledby="add-club-title"
        onClose={onClose}
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-full max-w-[460px] rounded-[22px] bg-white p-0 text-ink-900 shadow-[0_30px_80px_-20px_rgba(11,22,41,0.55)] backdrop:bg-[#0B1629]/45 backdrop:backdrop-blur-[3px] max-sm:mb-0 max-sm:max-w-none max-sm:rounded-b-none"
      >
        {open && (
          <Steps
            key={run}
            consoleUrl={consoleUrl}
            partners={partners}
            close={() => ref.current?.close()}
            again={() => setRun((r) => r + 1)}
          />
        )}
      </dialog>
    </>
  );
}

function Steps({
  consoleUrl,
  partners,
  close,
  again,
}: {
  consoleUrl: string;
  partners: Partner[];
  close: () => void;
  again: () => void;
}) {
  const [state, action] = useActionState<CreateClubState, FormData>(createClub, {});
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [editCode, setEditCode] = useState(false);
  const [tz, setTz] = useState('Africa/Nairobi');
  const [owner, setOwner] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  // A server error about the club's name belongs on step 1; everything else on step 2.
  useEffect(() => {
    if (state.error && /club’s name|club code/i.test(state.error)) setStep(1);
  }, [state.error]);
  const first = owner.trim().split(/\s+/)[0] ?? '';
  const done = state.done;
  const nameOk = name.trim().length >= 2;
  const ownerOk = owner.trim().length > 0 && EMAIL.test(email.trim()) && (!phone.trim() || PHONE.test(phone.trim()));

  const head = (label: string, filled: number) => (
    <header className="mb-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="add-club-title" className="text-[15px] font-semibold">
            Add a club
          </h2>
          <p className="text-[12px] text-ink-500">{label}</p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="-mr-2 -mt-1 grid h-9 w-9 place-items-center rounded-[10px] text-ink-500 hover:bg-slate-100"
        >
          <X size={18} />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span key={n} className={`h-1.5 rounded-full ${n <= filled ? 'bg-emerald-500' : 'bg-[#E7EBF3]'}`} />
        ))}
      </div>
    </header>
  );
  const big =
    'mt-6 flex h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-ink-900 text-[15px] font-semibold text-white transition hover:bg-ink-800 disabled:bg-[#C9D2DC]';
  const back = 'mt-1.5 w-full py-2 text-center text-[13px] font-semibold text-ink-500 hover:text-ink-900';
  const error = state.error ? (
    <p className="mb-4 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700 ring-1 ring-rose-200" role="alert">
      {state.error}
    </p>
  ) : null;

  if (done)
    return (
      <div className="p-6">
        {head('Done', 3)}
        <span className="grid h-11 w-11 place-items-center rounded-full bg-emerald-50 text-emerald-600">
          <Check size={22} strokeWidth={2.5} />
        </span>
        <h3 className="mt-3 text-[21px] font-bold leading-tight tracking-tight">{done.name} is ready</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
          {done.emailed ? (
            <>
              {done.ownerName.split(/\s+/)[0]}’s invitation is on its way to {done.ownerEmail}. The link works for 7
              days. Give this code to whoever installs the door PC.
            </>
          ) : (
            <span className="text-amber-800">
              The club is created, but the invitation email to {done.ownerEmail} did not go out. Resend it from the
              club’s page.
            </span>
          )}
        </p>
        <div className="mt-5 space-y-3.5">
          <Copyable label="NAVAC Bridge pairing code · valid 30 days" value={done.pairCode} big />
          <Copyable label="Club code" value={done.slug} />
          {consoleUrl && <Copyable label="Console" value={consoleUrl} />}
        </div>
        <Link href={`/partner/clubs/${done.tenantId}`} onClick={close} className={big}>
          Open the club
        </Link>
        <button type="button" onClick={again} className={back}>
          Add another club
        </button>
      </div>
    );

  return (
    <form action={action} className="p-6" noValidate>
      {/* Every field stays in the form across steps, so the last step sends them all. */}
      <input type="hidden" name="timezone" value={tz} />
      <div hidden={step !== 1}>
        {head('Step 1 of 3', 1)}
        {step === 1 && error}
        <h3 className="text-[21px] font-bold leading-tight tracking-tight">Which club?</h3>
        <p className="mt-1 text-[13px] text-ink-500">The name members will see on receipts and in their app.</p>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="label">Club name</span>
            <input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoComplete="off"
              placeholder="Enter club name"
              className="input mt-1.5"
            />
            {!editCode ? (
              <span className="mt-1.5 block text-xs text-ink-500">
                Club code: <span className="font-mono text-ink-700">{slugify(code || name || '')}</span> ·{' '}
                <button
                  type="button"
                  onClick={() => setEditCode(true)}
                  className="font-semibold text-ink-900 underline-offset-2 hover:underline"
                >
                  change
                </button>
              </span>
            ) : null}
          </label>
          <label className={editCode ? 'block' : 'hidden'}>
            <span className="label">Club code</span>
            <input
              name="slug"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={36}
              placeholder={slugify(name || 'club')}
              className="input mt-1.5"
            />
            <span className="mt-1 block text-xs text-ink-500">
              A short name for the club, used in its email address.
            </span>
          </label>
          <fieldset>
            <legend className="label">Time zone</legend>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
              {ZONES.map(([v, region, city]) => (
                <label
                  key={v}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border-[1.5px] px-3 py-2.5 text-[13.5px] transition ${tz === v ? 'border-emerald-600 bg-emerald-50' : 'border-[#E7EBF3] hover:bg-slate-50'}`}
                >
                  <input
                    type="radio"
                    name="tz-choice"
                    value={v}
                    checked={tz === v}
                    onChange={() => setTz(v)}
                    className="sr-only"
                  />
                  <span
                    className={`h-4 w-4 shrink-0 rounded-full ${tz === v ? 'border-[5px] border-emerald-600' : 'border-2 border-[#CBD3DD]'}`}
                  />
                  <span className="min-w-0">
                    <b className="block font-semibold">{city}</b>
                    <span className="block text-[11.5px] text-ink-500">{region}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {partners.length > 0 && (
            <label className="block">
              <span className="label">Partner</span>
              <select name="partnerId" defaultValue="" className="input mt-1.5">
                <option value="">NAVAC (no partner)</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-ink-500">Who sells and installs it.</span>
            </label>
          )}
        </div>
        <button type="button" disabled={!nameOk} onClick={() => setStep(2)} className={big}>
          Next
        </button>
      </div>

      <div hidden={step !== 2}>
        {head('Step 2 of 3', 2)}
        {step === 2 && error}
        <h3 className="text-[21px] font-bold leading-tight tracking-tight">Who runs it?</h3>
        <p className="mt-1 text-[13px] text-ink-500">
          They get an email invitation to set up the club, and a text so they don’t miss it.
        </p>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="label">Owner or manager</span>
            <input
              name="ownerName"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              maxLength={80}
              autoComplete="off"
              placeholder="Enter full name"
              className="input mt-1.5"
            />
          </label>
          <label className="block">
            <span className="label">Their email</span>
            <input
              name="ownerEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              placeholder="Enter email address"
              className="input mt-1.5"
            />
          </label>
          <label className="block">
            <span className="label">Their mobile</span>
            <input
              name="ownerPhone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07XX XXX XXX"
              className="input mt-1.5"
            />
            <span className="mt-1 block text-xs text-ink-500">Their sign-in codes go here.</span>
          </label>
        </div>
        <SubmitButton pendingText="Creating the club…" disabled={!ownerOk} className={big}>
          {first ? `Create club and invite ${first}` : 'Create club and invite the owner'}
        </SubmitButton>
        <button type="button" onClick={() => setStep(1)} className={back}>
          Back
        </button>
      </div>
    </form>
  );
}

function Copyable({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the value is selectable */
    }
  };
  return (
    <div>
      <span className="label">{label}</span>
      <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-ink-50 py-2 pl-3.5 pr-2 ring-1 ring-ink-100">
        <span
          className={`min-w-0 flex-1 select-all break-all font-mono ${big ? 'text-[18px] font-semibold tracking-[0.06em]' : 'text-[13px] text-ink-700'}`}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-semibold ring-1 ring-ink-100 hover:bg-slate-50"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
