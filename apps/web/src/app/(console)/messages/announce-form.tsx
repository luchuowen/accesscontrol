'use client';
import { useActionState, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { type AnnounceState, announce } from './actions';

const AUDIENCES = {
  current: 'Members with access now',
  lapsed: 'Members whose plan ended in the last 90 days',
  all: 'All members',
} as const;

const units = (t: string) => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: GSM-7 basic set check
  const gsm = /^[\x0A\x0D\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€]*$/.test(t);
  const [one, part] = gsm ? [160, 153] : [70, 67];
  return t.length <= one ? 1 : Math.ceil(t.length / part);
};

export function AnnounceForm({ club }: { club: string }) {
  const [state, action] = useActionState<AnnounceState, FormData>(announce, { step: 'edit' });
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  if (state.step === 'done')
    return (
      <div className="mt-6 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-200">
        Queued for {state.queued.toLocaleString('en-KE')} member{state.queued === 1 ? '' : 's'}. Messages go out outside
        quiet hours, and anyone who already had a message from the club today gets it tomorrow.
      </div>
    );
  if (state.step === 'confirm' && !editing) {
    const p = state.preview;
    return (
      <form action={action} className="mt-6 space-y-4 text-sm">
        <input type="hidden" name="text" value={state.text} />
        <input type="hidden" name="audience" value={state.audience} />
        <input type="hidden" name="confirm" value="yes" />
        <div className="rounded-xl bg-ink-50/60 p-4">
          <div className="label">Members will receive</div>
          <p className="mt-1.5 whitespace-pre-wrap">{p.body}</p>
        </div>
        <dl className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-ink-50/60 p-3">
            <dt className="label">Recipients</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{p.recipients.toLocaleString('en-KE')}</dd>
          </div>
          <div className="rounded-xl bg-ink-50/60 p-3">
            <dt className="label">SMS used</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{p.units.toLocaleString('en-KE')}</dd>
          </div>
          <div className="rounded-xl bg-ink-50/60 p-3">
            <dt className="label">Cost</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">KES {p.costKes.toLocaleString('en-KE')}</dd>
          </div>
        </dl>
        {p.units > p.balance && (
          <p className="text-rose-700">
            Your balance is {p.balance.toLocaleString('en-KE')} SMS. Buy more in Settings before sending.
          </p>
        )}
        <div className="flex gap-2">
          <SubmitButton pendingText="Queuing…" className="btn-primary flex-1">
            Send to {p.recipients.toLocaleString('en-KE')} member{p.recipients === 1 ? '' : 's'}
          </SubmitButton>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setText(state.text);
              setEditing(true);
            }}
          >
            Edit
          </button>
        </div>
      </form>
    );
  }
  const draft = editing || state.step !== 'edit' ? text : text || state.text || '';
  const audience = state.step === 'edit' ? state.audience : state.step === 'confirm' ? state.audience : undefined;
  const body = draft.trim() ? `${club}: ${draft.trim()}` : '';
  const u = body ? units(body) : 0;
  return (
    <form action={action} onSubmit={() => setEditing(false)} className="mt-6 space-y-3 text-sm">
      <select name="audience" defaultValue={audience ?? 'current'} className="input">
        {Object.entries(AUDIENCES).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <textarea
        name="text"
        rows={3}
        maxLength={300}
        required
        defaultValue={draft}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. The pool is closed on Saturday 10 Oct for maintenance. The gym is open as usual."
        className="input"
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-ink-500">
        <span>Starts with “{club}:” so members know who it is from.</span>
        <span className={`whitespace-nowrap ${u > 1 ? 'text-amber-700' : ''}`}>
          {body.length} characters · {u || 1} SMS each
        </span>
      </div>
      {state.step === 'edit' && state.error && <p className="text-rose-700">{state.error}</p>}
      <SubmitButton pendingText="Checking…" className="btn-ghost w-full">
        Preview recipients and cost
      </SubmitButton>
    </form>
  );
}
