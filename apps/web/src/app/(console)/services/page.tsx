import { durationLabel } from '@lango/core';
import { can } from '@lango/server';
import { DoorOpen, Pencil, Plus } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Notice } from '@/components/notice';
import { SubmitButton } from '@/components/submit-button';
import { PageHeader } from '@/components/ui';
import { type ServiceRow, servicesOverview } from '@/lib/data';
import { kes } from '@/lib/format';
import { canAny, requireSession } from '@/lib/session';
import { savePrice, setOnSale, updateService } from './actions';
import { NewService } from './new-service';

const UNITS = [
  ['hour', 'hours'],
  ['day', 'days'],
  ['week', 'weeks'],
  ['month', 'months'],
  ['year', 'years'],
] as const;
const input =
  'h-9 w-full rounded-[9px] border border-[#E5E8EE] bg-white px-2.5 text-[13px] outline-none focus:border-brand-500';

function PriceForm({ serviceId, p }: { serviceId: string; p?: ServiceRow['prices'][number] }) {
  return (
    <form action={savePrice} className="grid grid-cols-[56px_minmax(0,1fr)_minmax(0,1.1fr)_auto] gap-1.5">
      <input type="hidden" name="serviceId" value={serviceId} />
      {p && <input type="hidden" name="priceId" value={p.id} />}
      <input
        aria-label="Length"
        name="count"
        type="number"
        min={1}
        defaultValue={p?.duration_count ?? 1}
        className={input}
      />
      <select aria-label="Unit" name="unit" defaultValue={p?.duration_unit ?? 'month'} className={input}>
        {UNITS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <input
        aria-label="Price in KES"
        name="price"
        inputMode="numeric"
        required
        defaultValue={p?.price_kes}
        placeholder="KES"
        className={input}
      />
      <SubmitButton pendingText="…" className="h-9 rounded-[9px] bg-ink-900 px-3 text-xs font-semibold text-white">
        {p ? 'Save' : 'Add'}
      </SubmitButton>
    </form>
  );
}

export default async function Services({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const s = await requireSession();
  if (!canAny(s, 'plans.manage', 'reports.all')) redirect('/?denied=1');
  const { n } = await searchParams;
  const { services, areas } = await servicesOverview(s.tid);
  const edit = can(s, 'plans.manage');
  const areaName = (k: string) => areas.find((a) => a.key === k)?.name ?? k;
  const noDoors = (k: string) => (areas.find((a) => a.key === k)?.readers ?? 0) === 0;

  return (
    <>
      <PageHeader
        title="Services"
        subtitle="What your club sells. Each service opens its areas for the time paid. Changes apply to new sales only."
        actions={edit && <NewService areas={areas} />}
      />
      <Notice code={n} />
      {services.length === 0 && (
        <div className="card p-8 text-center text-sm text-ink-500">
          No services yet. Add your first one, for example Gym with a monthly price and a day pass.
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {services.map((sv) => {
          const onSale = sv.prices.filter((p) => p.active);
          const off = sv.prices.filter((p) => !p.active);
          return (
            <section key={sv.id} className={`card flex flex-col p-5 ${sv.active ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[17px] font-semibold tracking-tight">{sv.name}</h2>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sv.zone_keys.map((z) => (
                      <span
                        key={z}
                        title={noDoors(z) ? 'No doors linked to this area yet' : undefined}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${noDoors(z) ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' : 'bg-slate-100 text-ink-700'}`}
                      >
                        <DoorOpen size={12} /> {areaName(z)}
                        {noDoors(z) && ' · no doors yet'}
                      </span>
                    ))}
                  </div>
                </div>
                {!sv.active && <span className="text-xs text-ink-500">Not on sale</span>}
              </div>

              <ul className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
                {onSale.length === 0 && <li className="py-2.5 text-[13px] text-ink-500">No prices on sale.</li>}
                {[...onSale, ...off].map((p) => (
                  <li key={p.id} className={`py-2.5 ${p.active ? '' : 'opacity-50'}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[13.5px]">
                        {durationLabel({ unit: p.duration_unit, count: p.duration_count })}
                        <span className="ml-2 text-[11.5px] text-slate-400">{p.sold} sold</span>
                      </span>
                      <b className="text-[14px] font-semibold tabular-nums">{kes(p.price_kes)}</b>
                    </div>
                    {edit && (
                      <details className="group mt-1">
                        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[11.5px] text-ink-500 hover:text-ink-900">
                          <Pencil size={11} /> Change
                        </summary>
                        <div className="mt-2 space-y-2">
                          <PriceForm serviceId={sv.id} p={p} />
                          <form action={setOnSale}>
                            <input type="hidden" name="priceId" value={p.id} />
                            <input type="hidden" name="on" value={p.active ? 'false' : 'true'} />
                            <button type="submit" className="text-[11.5px] text-ink-500 hover:text-ink-900">
                              {p.active ? 'Stop selling this price' : 'Sell this price again'}
                            </button>
                          </form>
                        </div>
                      </details>
                    )}
                  </li>
                ))}
              </ul>

              {edit && sv.active && (
                <details className="mt-3">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold text-[#047857] hover:underline">
                    <Plus size={14} /> Add a price
                  </summary>
                  <div className="mt-2">
                    <PriceForm serviceId={sv.id} />
                  </div>
                </details>
              )}

              {edit && (
                <details className="mt-auto pt-4">
                  <summary className="cursor-pointer list-none text-xs font-medium text-ink-500 hover:text-ink-900">
                    Edit service
                  </summary>
                  <form action={updateService} className="mt-3 space-y-2.5">
                    <input type="hidden" name="serviceId" value={sv.id} />
                    <input name="name" required maxLength={60} defaultValue={sv.name} className={input} />
                    <div className="flex flex-wrap gap-1.5">
                      {areas.map((a) => (
                        <label
                          key={a.key}
                          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-ink-100"
                        >
                          <input
                            type="checkbox"
                            name="zones"
                            value={a.key}
                            defaultChecked={sv.zone_keys.includes(a.key)}
                            className="h-3.5 w-3.5 accent-[#047857]"
                          />
                          {a.name}
                        </label>
                      ))}
                    </div>
                    <SubmitButton pendingText="Saving…" className="btn-primary w-full">
                      Save service
                    </SubmitButton>
                  </form>
                  <form action={setOnSale} className="mt-2">
                    <input type="hidden" name="serviceId" value={sv.id} />
                    <input type="hidden" name="on" value={sv.active ? 'false' : 'true'} />
                    <button type="submit" className="w-full text-xs text-ink-500 hover:text-ink-900">
                      {sv.active ? 'Stop selling this service' : 'Sell this service again'}
                    </button>
                  </form>
                </details>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
