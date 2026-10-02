import { can } from '@lango/server';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { servicesOverview } from '@/lib/data';
import { canAny, requireSession } from '@/lib/session';
import { AddServices, ServicesBoard } from './board';

/**
 * Services (design A "Table + side panel", approved 2 Oct 2026): a summary row, then one table row per service with
 * what it opens, who can buy it, its prices, how many use it now and an on-sale switch. A row opens the side panel to
 * edit; "Add services" opens the ready list of common services.
 */
export default async function Services() {
  const s = await requireSession();
  if (!canAny(s, 'plans.manage', 'reports.all')) redirect('/?denied=1');
  const { services, areas } = await servicesOverview(s.tid);
  const edit = can(s, 'plans.manage');
  const ready = (x: (typeof services)[number]) => x.active && x.prices.some((p) => p.active);
  const top = [...services].sort((a, b) => b.sold30 - a.sold30)[0];
  const kpis = [
    ['On sale', String(services.filter(ready).length)],
    ['Using them now', String(services.reduce((n, x) => n + x.using, 0))],
    ['Sold last 30 days', String(services.reduce((n, x) => n + x.sold30, 0))],
    ['Most popular', top?.sold30 ? top.name : '—'],
  ];
  return (
    <>
      <PageHeader
        title="Services"
        subtitle="What your club sells. Each service opens its areas for the time paid. Price changes apply to new sales only."
        actions={edit && <AddServices have={services.map((x) => x.name)} />}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpis.map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-[#E7EBF3] bg-white px-4 py-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{k}</div>
            <div className="mt-1 truncate text-[22px] font-semibold tabular-nums tracking-tight">{v}</div>
          </div>
        ))}
      </div>
      <ServicesBoard services={services} areas={areas} edit={edit} />
    </>
  );
}
