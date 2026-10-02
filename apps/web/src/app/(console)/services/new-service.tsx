'use client';
import { Plus, Trash2, X } from 'lucide-react';
import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createService } from './actions';

/**
 * New service modal: name, the areas it opens (or a new area by name), and its prices. A live summary on the left
 * shows exactly what the desk will sell.
 */
const UNITS = [
  ['hour', 'hours'],
  ['day', 'days'],
  ['week', 'weeks'],
  ['month', 'months'],
  ['year', 'years'],
] as const;
const field =
  'h-11 w-full rounded-[11px] border border-[#E5E8EE] bg-white px-3.5 text-sm text-ink-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-emerald-500/15';
type Row = { count: string; unit: string; price: string };
const length = (r: Row) => {
  const n = Number(r.count) || 1;
  return `${n} ${r.unit}${n === 1 ? '' : 's'}`;
};

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 items-center justify-center rounded-[11px] bg-[#047857] px-4 text-sm font-semibold text-white transition hover:bg-[#065F46] disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save service'}
    </button>
  );
}

export function NewService({ areas }: { areas: { key: string; name: string; readers: number }[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, action] = useActionState(createService, {});
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [newArea, setNewArea] = useState('');
  const [rows, setRows] = useState<Row[]>([{ count: '1', unit: 'day', price: '' }]);
  const open = () => {
    setName('');
    setPicked([]);
    setNewArea('');
    setRows([{ count: '1', unit: 'day', price: '' }]);
    ref.current?.showModal();
  };
  const close = () => ref.current?.close();
  const set = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const areaNames = [...areas.filter((a) => picked.includes(a.key)).map((a) => a.name), newArea.trim()].filter(Boolean);

  return (
    <>
      <button type="button" onClick={open} className="btn-primary">
        <Plus size={16} /> New service
      </button>
      <dialog
        ref={ref}
        aria-labelledby="new-service-title"
        onClick={(e) => e.target === ref.current && close()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
        className="m-auto w-full max-w-[820px] overflow-hidden rounded-[20px] bg-white p-0 text-ink-900 shadow-[0_30px_80px_-20px_rgba(11,22,41,0.55)] backdrop:bg-[#0B1629]/45 backdrop:backdrop-blur-[3px] open:animate-[pop_.28s_cubic-bezier(.2,.9,.3,1.2)] max-sm:mb-0 max-sm:max-w-none max-sm:rounded-b-none motion-reduce:open:animate-none"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-[10px] text-ink-500 hover:bg-slate-100 hover:text-ink-900 max-sm:text-white/80 max-sm:hover:bg-white/10"
        >
          <X size={18} />
        </button>
        <div className="grid sm:grid-cols-[280px_minmax(0,1fr)]">
          <div className="relative flex flex-col gap-4 overflow-hidden bg-[radial-gradient(120%_120%_at_0%_0%,#163257_0%,#0B1629_60%)] p-6 text-white max-sm:p-5">
            <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_100%_100%,rgba(16,185,129,0.22),transparent_70%)]" />
            <div className="relative">
              <h2 id="new-service-title" className="text-xl font-semibold tracking-tight">
                New service
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#A3B3C9]">
                Anything your club sells. It opens its areas for the time paid.
              </p>
            </div>
            <div className="relative mt-auto rounded-2xl border border-white/10 bg-white/[0.06] p-4 max-sm:hidden">
              <div className="truncate text-[17px] font-semibold">{name.trim() || 'Service name'}</div>
              <div className="mt-1 truncate text-xs text-[#A3B3C9]">
                Opens {areaNames.length ? areaNames.join(', ') : '…'}
              </div>
              <ul className="mt-3 space-y-1.5 text-[13px]">
                {rows.map((r, i) => (
                  <li
                    key={`p${i}`}
                    className="flex justify-between gap-3 border-t border-white/10 pt-1.5 first:border-t-0"
                  >
                    <span className="text-[#C7D2E1]">{length(r)}</span>
                    <b className="tabular-nums">KES {Number(r.price || 0).toLocaleString('en-KE')}</b>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <form action={action} className="flex flex-col gap-4 p-6 pt-12 max-sm:p-5">
            {state.error && (
              <div
                role="alert"
                className="rounded-[11px] bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800 ring-1 ring-rose-200"
              >
                {state.error}
              </div>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-ink-700">Service Name</span>
              <input
                name="name"
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter a name, e.g. Swimming"
                className={field}
              />
            </label>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-[12.5px] font-semibold text-ink-700">Areas It Opens</legend>
              <div className="flex flex-wrap gap-2">
                {areas.map((a) => (
                  <label
                    key={a.key}
                    className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] ${picked.includes(a.key) ? 'border-brand-500 bg-emerald-50 text-ink-900' : 'border-[#E5E8EE]'}`}
                  >
                    <input
                      type="checkbox"
                      name="zones"
                      value={a.key}
                      checked={picked.includes(a.key)}
                      onChange={(e) =>
                        setPicked(e.target.checked ? [...picked, a.key] : picked.filter((k) => k !== a.key))
                      }
                      className="h-3.5 w-3.5 accent-[#047857]"
                    />
                    {a.name}
                  </label>
                ))}
              </div>
              <input
                name="newArea"
                maxLength={40}
                value={newArea}
                onChange={(e) => setNewArea(e.target.value)}
                placeholder="Or add a new area, e.g. Sauna room"
                className={`${field} mt-1`}
              />
              <span className="text-xs text-ink-500">Doors are linked to an area when the door PC is set up.</span>
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[12.5px] font-semibold text-ink-700">Prices</legend>
              {rows.map((r, i) => (
                <div key={`r${i}`} className="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1.2fr)_36px] gap-2">
                  <input
                    aria-label="Length"
                    type="number"
                    min={1}
                    value={r.count}
                    onChange={(e) => set(i, 'count', e.target.value)}
                    className={field}
                  />
                  <select
                    aria-label="Unit"
                    value={r.unit}
                    onChange={(e) => set(i, 'unit', e.target.value)}
                    className={field}
                  >
                    {UNITS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <span className="flex overflow-hidden rounded-[11px] border border-[#E5E8EE] focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-emerald-500/15">
                    <span className="flex items-center border-r border-[#E5E8EE] bg-slate-50 px-2.5 text-xs font-semibold text-ink-700">
                      KES
                    </span>
                    <input
                      aria-label="Price"
                      inputMode="numeric"
                      value={r.price}
                      onChange={(e) => set(i, 'price', e.target.value.replace(/[^\d]/g, ''))}
                      placeholder="Amount"
                      className="h-11 min-w-0 flex-1 px-3 text-sm outline-none placeholder:text-slate-400"
                    />
                  </span>
                  <button
                    type="button"
                    aria-label="Remove price"
                    disabled={rows.length === 1}
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    className="grid h-11 w-9 place-items-center rounded-[10px] text-ink-500 hover:bg-slate-100 disabled:opacity-30"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setRows([...rows, { count: '1', unit: 'month', price: '' }])}
                className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-[#047857] hover:underline"
              >
                <Plus size={14} /> Add another price
              </button>
            </fieldset>
            <input type="hidden" name="prices" value={JSON.stringify(rows)} />
            <div className="mt-1 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={close}
                className="inline-flex h-11 items-center rounded-[11px] border border-[#E5E8EE] bg-white px-4 text-sm font-semibold hover:bg-slate-50"
              >
                Cancel
              </button>
              <Save />
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
