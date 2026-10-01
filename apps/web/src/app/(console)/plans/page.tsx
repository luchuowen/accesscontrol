import { Badge, PageHeader } from '@/components/ui';
import { products } from '@/lib/data';
import { kes } from '@/lib/format';
import { requireSession } from '@/lib/session';

const kinds: Record<string, string> = {
  membership: 'Membership',
  day_pass: 'Day pass',
  addon: 'Add-on',
  bundle: 'Bundle',
};

export default async function Plans() {
  const s = await requireSession();
  const rows = await products(s.tid);
  return (
    <>
      <PageHeader
        title="Plans & pricing"
        subtitle="Each plan opens specific doors for a fixed period. Keep prices fixed — the amount paid is how a direct paybill payment is matched to a plan."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((p) => (
          <div key={p.id} className={`card p-6 ${p.active ? '' : 'opacity-50'}`}>
            <div className="flex items-start justify-between">
              <Badge tone={p.kind === 'bundle' ? 'blue' : p.kind === 'membership' ? 'green' : 'gray'}>
                {kinds[p.kind]}
              </Badge>
              <span className="text-xs text-ink-500">{p.sold} sold</span>
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
                <Badge key={z}>{z}</Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
