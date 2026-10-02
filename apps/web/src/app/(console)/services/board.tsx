'use client';
import {
  Baby,
  Book,
  Car,
  Check,
  Cloud,
  Coffee,
  Droplet,
  Dumbbell,
  Flag,
  Flame,
  Laptop,
  Layers,
  Loader2,
  Lock,
  type LucideIcon,
  Mountain,
  Music,
  Package,
  Plus,
  Presentation,
  Search,
  Sparkles,
  Target,
  Trash2,
  User,
  Volleyball,
  Waves,
  X,
} from 'lucide-react';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { MoneyInput } from '@/components/money-input';
import type { ServiceRow } from '@/lib/data';
import { kes } from '@/lib/format';
import { addServices, savePrice, saveService, setOnSale } from './actions';
import { CATALOG, CATALOG_ITEMS, CATEGORIES, SOLD_TO } from './catalog';

type Area = { key: string; name: string; readers: number };
const ICON: Record<string, LucideIcon> = {
  dumbbell: Dumbbell,
  music: Music,
  user: User,
  mountain: Mountain,
  waves: Waves,
  flame: Flame,
  cloud: Cloud,
  sparkles: Sparkles,
  droplet: Droplet,
  target: Target,
  volleyball: Volleyball,
  flag: Flag,
  laptop: Laptop,
  presentation: Presentation,
  book: Book,
  baby: Baby,
  lock: Lock,
  car: Car,
  coffee: Coffee,
  package: Package,
  layers: Layers,
};
function Ico({ name, size = 16 }: { name: string | null; size?: number }) {
  const I = ICON[name ?? ''] ?? Layers;
  return <I size={size} />;
}
const tile = 'grid shrink-0 place-items-center rounded-[10px] bg-slate-100 text-ink-700';
const field =
  'h-10 w-full min-w-0 rounded-[10px] border border-[#E5E8EE] bg-white px-3 text-[13px] text-ink-900 outline-none transition focus:border-[#047857] focus:ring-4 focus:ring-emerald-500/10';
const label = 'text-[12px] font-semibold text-ink-700';
const UNITS = ['hour', 'day', 'week', 'month', 'year'] as const;
const soldTo = (v: string) => SOLD_TO.find(([k]) => k === v)?.[1] ?? 'Members & walk-ins';
const len = (p: ServiceRow['prices'][number]) =>
  p.duration_unit === 'day' && p.duration_count === 1
    ? 'Day pass'
    : `${p.duration_count} ${p.duration_unit}${p.duration_count === 1 ? '' : 's'}`;

function Toggle({
  on,
  disabled,
  onClick,
  label: l,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={l}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-40 ${on ? 'bg-[#047857]' : 'bg-slate-300'}`}
    >
      <i
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  );
}

export function ServicesBoard({ services, areas, edit }: { services: ServiceRow[]; areas: Area[]; edit: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [, start] = useTransition();
  const areaName = (k: string) => areas.find((a) => a.key === k)?.name ?? k;
  const noDoors = (k: string) => (areas.find((a) => a.key === k)?.readers ?? 0) === 0;
  const rows = services.filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()));
  const cur = services.find((s) => s.id === open) ?? null;
  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-[#E7EBF3] bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#EEF1F6] p-3">
          <label className="flex h-10 w-full max-w-[360px] items-center gap-2.5 rounded-xl border border-[#E5E8EE] px-3 text-ink-300 focus-within:border-slate-300">
            <Search size={16} />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search services"
              aria-label="Search services"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-300"
            />
          </label>
          {edit && <span className="ml-auto text-[12px] text-ink-500">Click a service to edit it</span>}
        </div>
        {services.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-ink-500">
            No services yet. Use “Add services” and pick what your club offers.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#EEF1F6]">
                  {['Service', 'Opens', 'Who can buy', 'Price', 'Using now', 'On sale'].map((h) => (
                    <th
                      key={h}
                      className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 ${h === 'Using now' ? 'text-right' : ''}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1F6]">
                {rows.map((s) => {
                  const live = s.prices.filter((p) => p.active);
                  const cheapest = live.length ? Math.min(...live.map((p) => p.price_kes)) : null;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => edit && setOpen(s.id)}
                      className={`transition ${edit ? 'cursor-pointer hover:bg-slate-50' : ''} ${open === s.id ? 'bg-slate-50 shadow-[inset_3px_0_0_#0c1220]' : ''} ${s.active ? '' : 'text-ink-500'}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className={`${tile} h-9 w-9`}>
                            <Ico name={s.icon} />
                          </span>
                          <span className="min-w-0">
                            <b className="block truncate font-semibold text-ink-900">{s.name}</b>
                            <span className="text-[12px] text-ink-500">{s.category ?? 'Other'}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex max-w-[280px] flex-wrap gap-1">
                          {s.zone_keys.map((z) => (
                            <span
                              key={z}
                              title={noDoors(z) ? 'No doors linked to this area yet (Doors & access)' : undefined}
                              className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] ${noDoors(z) ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' : 'bg-slate-100 text-ink-700'}`}
                            >
                              {areaName(z)}
                              {noDoors(z) && ' · no doors yet'}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[12.5px] text-ink-700">{soldTo(s.sold_to)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[12.5px]">
                        {cheapest === null ? (
                          <span className="font-semibold text-amber-700">Add prices</span>
                        ) : (
                          <>
                            <b className="font-semibold text-ink-900">{kes(cheapest)}</b>
                            {live.length > 1 && <span className="text-ink-500"> · {live.length} prices</span>}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.using}</td>
                      <td className="px-4 py-3">
                        <Toggle
                          label={`${s.name} on sale`}
                          on={s.active && live.length > 0}
                          disabled={!edit || !live.length}
                          onClick={() => start(() => void setOnSale({ serviceId: s.id }, !s.active))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="px-5 py-10 text-center text-sm text-ink-500">No service by that name.</p>
            )}
          </div>
        )}
      </section>
      {cur && <Panel key={cur.id} s={cur} areas={areas} onClose={() => setOpen(null)} />}
    </>
  );
}

function Save({ children = 'Save', small, quiet }: { children?: React.ReactNode; small?: boolean; quiet?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[10px] font-semibold transition disabled:opacity-60 ${quiet ? 'border border-[#E5E8EE] bg-white text-ink-900 hover:bg-slate-50' : 'bg-[#047857] text-white hover:bg-[#065F46]'} ${small ? 'h-10 px-3 text-[12.5px]' : 'h-11 w-full text-sm'}`}
    >
      {pending && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

function Panel({ s, areas, onClose }: { s: ServiceRow; areas: Area[]; onClose: () => void }) {
  const [state, action] = useActionState(saveService, {});
  const [zones, setZones] = useState<string[]>(s.zone_keys);
  const [who, setWho] = useState<string>(s.sold_to);
  const [, start] = useTransition();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  const live = s.prices.filter((p) => p.active);
  const off = s.prices.filter((p) => !p.active);
  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-[#0B1629]/30 lg:bg-[#0B1629]/10"
      />
      <aside
        role="dialog"
        aria-label={`Edit ${s.name}`}
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[448px] flex-col gap-5 overflow-y-auto border-l border-[#E7EBF3] bg-white p-5 shadow-[-24px_0_48px_-24px_rgba(11,22,41,0.25)] motion-safe:animate-[pop_.2s_ease-out]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-[10px] text-ink-500 hover:bg-slate-100"
        >
          <X size={18} />
        </button>
        <div className="flex items-center gap-3 pr-10">
          <span className={`${tile} h-11 w-11`}>
            <Ico name={s.icon} size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-semibold tracking-tight">{s.name}</h2>
            <p className="text-[12.5px] text-ink-500">
              {s.category ?? 'Other'} · {s.using} using it now · {s.sold30} sold in 30 days
            </p>
          </div>
        </div>

        <form action={action} className="flex flex-col gap-3.5">
          <input type="hidden" name="serviceId" value={s.id} />
          <input type="hidden" name="soldTo" value={who} />
          <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2.5">
            <label className="flex flex-col gap-1.5">
              <span className={label}>Name</span>
              <input name="name" required maxLength={60} defaultValue={s.name} className={field} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={label}>Group</span>
              <select name="category" defaultValue={s.category ?? 'Other'} className={field}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className={`${label} mb-1.5`}>Opens these areas</legend>
            <div className="flex flex-wrap gap-1.5">
              {areas.map((a) => {
                const on = zones.includes(a.key);
                return (
                  <label
                    key={a.key}
                    className={`cursor-pointer rounded-full px-3 py-1 text-[12px] font-medium transition ${on ? 'bg-[#0B1629] text-white' : 'bg-slate-100 text-ink-700 hover:bg-slate-200'}`}
                  >
                    <input
                      type="checkbox"
                      name="zones"
                      value={a.key}
                      checked={on}
                      onChange={() => setZones(on ? zones.filter((z) => z !== a.key) : [...zones, a.key])}
                      className="sr-only"
                    />
                    {a.name}
                  </label>
                );
              })}
            </div>
            <input name="newArea" maxLength={40} placeholder="Or add a new area, e.g. Studio 2" className={field} />
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className={`${label} mb-1.5`}>Who can buy it</legend>
            <div className="flex rounded-[11px] bg-slate-100 p-1">
              {SOLD_TO.map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setWho(k)}
                  aria-pressed={who === k}
                  className={`h-8 flex-1 rounded-[8px] text-[12px] font-semibold transition ${who === k ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900'}`}
                >
                  {k === 'both' ? 'Both' : l}
                </button>
              ))}
            </div>
            <p className="text-[11.5px] text-ink-500">
              {who === 'members'
                ? 'Sold to members only: renewals and M-Pesa prompts. Not at the walk-in desk.'
                : who === 'walkins'
                  ? 'Sold at the walk-in desk only, up to one day at a time.'
                  : 'Members renew it; walk-ins can buy passes of up to one day.'}
            </p>
          </fieldset>
          {state.error && (
            <p className="rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{state.error}</p>
          )}
          {state.ok && (
            <p className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#047857]">
              <Check size={14} /> Saved
            </p>
          )}
          <Save>Save details</Save>
        </form>

        <section className="flex flex-col gap-2 border-t border-[#EEF1F6] pt-4">
          <div className="flex items-baseline justify-between">
            <h3 className={label}>Prices</h3>
            <span className="text-[11.5px] text-ink-500">Changes apply to new sales</span>
          </div>
          {live.map((p) => (
            <PriceRow key={p.id} serviceId={s.id} p={p} />
          ))}
          <PriceRow serviceId={s.id} />
          {off.length > 0 && (
            <div className="mt-1 flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Not on sale</span>
              {off.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-[12.5px] text-ink-500">
                  <span>
                    {len(p)} · {kes(p.price_kes)}
                  </span>
                  <button
                    type="button"
                    onClick={() => start(() => void setOnSale({ priceId: p.id }, true))}
                    className="font-semibold text-[#047857] hover:underline"
                  >
                    Sell again
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mt-auto flex items-center justify-between border-t border-[#EEF1F6] pt-4">
          <span className={label}>On sale</span>
          <Toggle
            label="On sale"
            on={s.active && live.length > 0}
            disabled={!live.length}
            onClick={() => start(() => void setOnSale({ serviceId: s.id }, !s.active))}
          />
        </div>
        <p className="-mt-3 text-[11.5px] text-ink-500">
          {live.length ? 'Stopping a sale never locks out anyone already paid.' : 'Add a price to put it on sale.'}
        </p>
      </aside>
    </>
  );
}

function PriceRow({ serviceId, p }: { serviceId: string; p?: ServiceRow['prices'][number] }) {
  const [state, action] = useActionState(savePrice, {});
  const [, start] = useTransition();
  const [key, setKey] = useState(0);
  // A new price clears itself once it has been added.
  useEffect(() => {
    if (!p && state.ok) setKey((k) => k + 1);
  }, [state, p]);
  return (
    <form key={key} action={action} className="flex flex-col gap-1">
      <input type="hidden" name="serviceId" value={serviceId} />
      {p && <input type="hidden" name="priceId" value={p.id} />}
      <div className="grid grid-cols-[minmax(0,1.3fr)_auto_44px_minmax(0,1fr)_auto] items-center gap-1.5">
        <MoneyInput name="price" required defaultValue={p?.price_kes} className="h-10" />
        <span className="text-[12px] text-ink-500">for</span>
        <input
          aria-label="Length"
          name="count"
          inputMode="numeric"
          maxLength={3}
          defaultValue={p?.duration_count ?? 1}
          className={`${field} px-1 text-center tabular-nums`}
        />
        <select aria-label="Unit" name="unit" defaultValue={p?.duration_unit ?? 'month'} className={`${field} px-2`}>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}s
            </option>
          ))}
        </select>
        {p ? (
          <span className="flex gap-1">
            <Save small quiet>
              Save
            </Save>
            <button
              type="button"
              aria-label="Stop selling this price"
              title="Stop selling this price"
              onClick={() => start(() => void setOnSale({ priceId: p.id }, false))}
              className="grid h-10 w-9 place-items-center rounded-[10px] text-slate-400 hover:bg-rose-50 hover:text-rose-600"
            >
              <Trash2 size={15} />
            </button>
          </span>
        ) : (
          <Save small>
            <Plus size={14} /> Add
          </Save>
        )}
      </div>
      {state.error && <p className="text-[12px] text-rose-700">{state.error}</p>}
      {p && state.ok && <p className="text-[12px] font-semibold text-[#047857]">{state.ok}</p>}
    </form>
  );
}

/** "Add services": the ready list of common services, grouped, plus "Something else" for the club's own. */
export function AddServices({ have }: { have: string[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [cat, setCat] = useState('All');
  const [sel, setSel] = useState<string[]>([]);
  const [own, setOwn] = useState({ name: '', category: 'Other' });
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const lower = have.map((h) => h.toLowerCase());
  const added = (n: string) => lower.includes(n.toLowerCase());
  const open = () => {
    setSel([]);
    setOwn({ name: '', category: 'Other' });
    setErr('');
    setCat('All');
    ref.current?.showModal();
  };
  const close = () => ref.current?.close();
  const list = CATALOG_ITEMS.filter((i) => cat === 'All' || i.cat === cat);
  const count = sel.length + (own.name.trim() ? 1 : 0);
  const submit = () =>
    start(async () => {
      const picks = [
        ...sel.map((name) => ({ name })),
        ...(own.name.trim() ? [{ name: own.name.trim(), category: own.category }] : []),
      ];
      const r = await addServices(picks);
      if (r.error) setErr(r.error);
      else close();
    });
  return (
    <>
      <button type="button" onClick={open} className="btn-primary">
        <Plus size={16} /> Add services
      </button>
      <dialog
        ref={ref}
        aria-labelledby="add-services-title"
        onClick={(e) => e.target === ref.current && close()}
        className="m-auto w-full max-w-[880px] overflow-hidden rounded-[20px] bg-white p-0 text-ink-900 shadow-[0_30px_80px_-20px_rgba(11,22,41,0.55)] backdrop:bg-[#0B1629]/45 backdrop:backdrop-blur-[3px] open:animate-[pop_.28s_cubic-bezier(.2,.9,.3,1.2)] max-sm:mb-0 max-sm:max-w-none max-sm:rounded-b-none motion-reduce:open:animate-none"
      >
        <div className="flex max-h-[88vh] flex-col">
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-[10px] text-ink-500 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
          <div className="px-6 pt-6">
            <h2 id="add-services-title" className="text-[19px] font-semibold tracking-tight">
              Add services
            </h2>
            <p className="mt-1 text-[13px] text-ink-500">
              Pick everything your business offers. You set the doors and prices for each one next.
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {['All', ...CATALOG.map(([c]) => c)].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCat(c)}
                  className={`h-8 rounded-full border px-3 text-[12px] font-semibold transition ${cat === c ? 'border-[#0B1629] bg-[#0B1629] text-white' : 'border-[#E5E8EE] bg-white text-ink-700 hover:border-slate-300'}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-y-auto px-6 py-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((i) => {
              const on = sel.includes(i.name);
              const has = added(i.name);
              return (
                <button
                  key={i.name}
                  type="button"
                  disabled={has}
                  onClick={() => setSel(on ? sel.filter((n) => n !== i.name) : [...sel, i.name])}
                  aria-pressed={on}
                  className={`relative flex items-start gap-3 rounded-2xl border-[1.5px] p-3 text-left transition disabled:opacity-50 ${on ? 'border-[#047857] bg-emerald-50/40' : 'border-[#E5E8EE] hover:border-slate-300'}`}
                >
                  <span className={`${tile} h-9 w-9`}>
                    <Ico name={i.icon} />
                  </span>
                  <span className="min-w-0 pr-5">
                    <b className="block text-[13px] font-semibold">{i.name}</b>
                    <span className="block text-[11.5px] text-ink-500">{has ? 'Already added' : i.sub}</span>
                    {!has && <span className="mt-0.5 block text-[11.5px] text-ink-700">{i.lengths}</span>}
                  </span>
                  <span
                    className={`absolute right-3 top-3 grid h-[18px] w-[18px] place-items-center rounded-full border-[1.5px] ${on ? 'border-[#047857] bg-[#047857] text-white' : 'border-slate-300'}`}
                  >
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
            <div className="flex flex-col gap-2 rounded-2xl border-[1.5px] border-dashed border-[#CBD5E1] p-3">
              <span className="flex items-center gap-2 text-[13px] font-semibold">
                <Plus size={15} /> Something else
              </span>
              <input
                value={own.name}
                maxLength={60}
                onChange={(e) => setOwn({ ...own, name: e.target.value })}
                placeholder="Name, e.g. Boxing ring"
                className={field}
              />
              <select
                value={own.category}
                onChange={(e) => setOwn({ ...own, category: e.target.value })}
                aria-label="Group"
                className={field}
              >
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-[#EEF1F6] px-6 py-4">
            <span className="text-[12.5px] text-ink-500">
              {err ? (
                <span className="text-rose-700">{err}</span>
              ) : count ? (
                `${count} selected`
              ) : (
                'Nothing selected yet'
              )}
            </span>
            <button
              type="button"
              onClick={close}
              className="ml-auto h-10 rounded-xl border border-[#E5E8EE] px-4 text-[13px] font-semibold hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!count || pending}
              onClick={submit}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#047857] px-4 text-[13px] font-semibold text-white hover:bg-[#065F46] disabled:opacity-50"
            >
              {pending && <Loader2 size={14} className="animate-spin" />}
              Add {count || ''} {count === 1 ? 'service' : 'services'}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
