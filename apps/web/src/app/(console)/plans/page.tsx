import { withTenant } from '@lango/db';
import { can } from '@lango/server';
import { Plus } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Notice } from '@/components/notice';
import { SubmitButton } from '@/components/submit-button';
import { Badge, PageHeader } from '@/components/ui';
import { products } from '@/lib/data';
import { kes } from '@/lib/format';
import { canAny, requireSession } from '@/lib/session';
import { db } from '@/server/db';
import { savePlan, setPlanActive } from '../actions';

const kinds: Record<string, string> = {
  membership: 'Membership',
  day_pass: 'Day pass',
  addon: 'Add-on',
  bundle: 'Bundle',
};

type Plan = Awaited<ReturnType<typeof products>>[number];

function PlanForm({ plan, zones }: { plan?: Plan; zones: { key: string; name: string }[] }) {
  return (
    <form action={savePlan} className="space-y-3">
      {plan && <input type="hidden" name="planId" value={plan.id} />}
      <input
        name="name"
        required
        defaultValue={plan?.name}
        placeholder="Plan name, e.g. Gym · 1 month"
        className="input"
      />
      <div className="grid grid-cols-2 gap-2">
        <select name="kind" defaultValue={plan?.kind ?? 'membership'} className="input">
          {Object.entries(kinds).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          name="price"
          required
          inputMode="numeric"
          defaultValue={plan?.price_kes}
          placeholder="Price (KES)"
          className="input"
        />
        <input
          name="count"
          type="number"
          min={1}
          max={366}
          required
          defaultValue={plan?.duration_count ?? 1}
          className="input"
        />
        <select name="unit" defaultValue={plan?.duration_unit ?? 'month'} className="input">
          <option value="month">calendar month(s)</option>
          <option value="day">day(s)</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        {zones.map((z) => (
          <label key={z.key} className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ring-1 ring-ink-100">
            <input
              type="checkbox"
              name="zones"
              value={z.key}
              defaultChecked={plan?.zone_keys.includes(z.key)}
              className="h-3.5 w-3.5 accent-ink-900"
            />
            {z.name}
          </label>
        ))}
        {zones.length === 0 && (
          <span className="text-xs text-ink-500">Create zones under Doors &amp; access first.</span>
        )}
      </div>
      <SubmitButton pendingText="Saving…" className="btn-primary w-full">
        {plan ? 'Save changes' : 'Add plan'}
      </SubmitButton>
    </form>
  );
}

export default async function Plans({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const s = await requireSession();
  if (!canAny(s, 'plans.manage', 'reports.all')) redirect('/?denied=1');
  const { n } = await searchParams;
  const rows = await products(s.tid);
  const zones = await withTenant(
    db(),
    s.tid,
    (tx) => tx<{ key: string; name: string }[]>`select distinct on (key) key, name from zones order by key`,
  );
  const edit = can(s, 'plans.manage');
  return (
    <>
      <Notice code={n} />
      <PageHeader
        title="Plans & pricing"
        subtitle="Each plan opens specific zones for a fixed period. Every active plan has its own price, so a paybill payment always matches exactly one plan."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {edit && (
          <details className="card p-6">
            <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
              <Plus size={16} /> New plan
            </summary>
            <div className="mt-4">
              <PlanForm zones={zones} />
            </div>
          </details>
        )}
        {rows.map((p) => (
          <div key={p.id} className={`card p-6 ${p.active ? '' : 'opacity-60'}`}>
            <div className="flex items-start justify-between">
              <Badge tone={p.kind === 'bundle' ? 'blue' : p.kind === 'membership' ? 'green' : 'gray'}>
                {kinds[p.kind]}
              </Badge>
              <span className="text-xs text-ink-500">
                {p.sold} sold{p.active ? '' : ' · archived'}
              </span>
            </div>
            <div className="mt-4 text-lg font-semibold tracking-tight">{p.name}</div>
            <div className="mt-1 text-[26px] font-semibold tabular-nums">{kes(p.price_kes)}</div>
            <div className="mt-1 text-sm text-ink-500">
              {p.duration_count}{' '}
              {p.duration_unit === 'month'
                ? p.duration_count > 1
                  ? 'calendar months'
                  : 'calendar month'
                : p.duration_count > 1
                  ? 'days'
                  : 'day (until 23:59)'}
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {p.zone_keys.map((z) => (
                <Badge key={z}>{zones.find((x) => x.key === z)?.name ?? z}</Badge>
              ))}
            </div>
            {edit && (
              <details className="mt-4 border-t border-ink-100 pt-3">
                <summary className="cursor-pointer list-none text-xs font-medium text-ink-500 hover:text-ink-900">
                  Edit
                </summary>
                <div className="mt-3 space-y-3">
                  <PlanForm plan={p} zones={zones} />
                  <form action={setPlanActive}>
                    <input type="hidden" name="planId" value={p.id} />
                    <input type="hidden" name="active" value={p.active ? 'false' : 'true'} />
                    <button type="submit" className="w-full text-xs text-ink-500 hover:text-ink-900">
                      {p.active ? 'Archive (stop selling)' : 'Put back on sale'}
                    </button>
                  </form>
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
