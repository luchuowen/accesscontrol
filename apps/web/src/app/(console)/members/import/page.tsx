import { withTenant } from '@lango/db';
import { can, planImport, STAFF_GROUP } from '@lango/server';
import { ArrowLeft, Check, Download, MonitorSmartphone, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AddMember } from '@/components/add-member';
import { SubmitButton } from '@/components/submit-button';
import { PageHeader } from '@/components/ui';
import { nextMemberNo } from '@/lib/data';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';
import { importFromDoors } from './actions';
import { ExcelImport } from './excel-import';

/** Three ways to bring members in: from the door system, from Excel, or one at a time. */
export default async function ImportMembers({
  searchParams,
}: {
  searchParams: Promise<{ doors?: string; withAccess?: string; existing?: string; n?: string }>;
}) {
  const s = await requireSession();
  if (!can(s, 'members.edit')) redirect('/members?n=forbidden');
  const q = await searchParams;
  const [nextNo, [t], preview] = await Promise.all([
    nextMemberNo(s.tid),
    db()<{ name: string }[]>`select name from tenants where id = ${s.tid}`,
    withTenant(db(), s.tid, async (tx) => {
      const [row] = await tx<{ id: string; groups: { id: number; name: string }[] | null; timezone: string }[]>`
        select si.id, i.data->'groups' as groups, tn.timezone from sites si
        join tenants tn on tn.id = si.tenant_id left join site_inventory i on i.site_id = si.id
        order by si.created_at limit 1`;
      if (!row?.groups) return null;
      const ids = row.groups.filter((g) => !STAFF_GROUP.test(g.name)).map((g) => g.id);
      const plan = await planImport(tx, row.id, row.timezone, 14, ids);
      return {
        create: plan.create.length,
        withAccess: plan.create.filter((c) => c.until).length,
        existing: plan.existing,
      };
    }),
  ]);
  const card = 'flex flex-col gap-3 rounded-2xl border border-[#E7EBF3] bg-white p-5';
  const step = (icon: React.ReactNode, title: string, sub: string) => (
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0B1629] text-[#34D399]">{icon}</span>
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-[13px] text-ink-500">{sub}</p>
      </div>
    </div>
  );
  return (
    <>
      <Link href="/members" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900">
        <ArrowLeft size={15} /> Members
      </Link>
      <PageHeader
        title="Add members"
        subtitle="Pick how your club keeps its members today. You can use more than one."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <section className={card}>
          {step(
            <MonitorSmartphone size={19} />,
            'From the door system',
            'Already using AxTraxNG? Bring everyone in with their cards and current access.',
          )}
          {q.doors ? (
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-[#047857]">
              <Check size={16} /> {q.doors} added, {q.withAccess} with access kept
              {Number(q.existing) ? ` · ${q.existing} were already here` : ''}
            </p>
          ) : preview ? (
            <>
              <p className="text-sm">
                <b>{preview.create}</b> members to add
                {preview.withAccess ? `, ${preview.withAccess} with access they already have` : ''}
                {preview.existing ? ` · ${preview.existing} already in Lango` : ''}. Staff and security groups are left
                out.
              </p>
              {preview.create > 0 ? (
                <form action={importFromDoors}>
                  <SubmitButton pendingText="Importing…" className="btn-primary">
                    Import {preview.create} members
                  </SubmitButton>
                </form>
              ) : (
                <p className="text-sm text-[#047857]">Everyone in the door system is already in Lango.</p>
              )}
              <p className="text-xs text-ink-500">
                Anyone with no end date in the door system gets 14 days to pay. Nobody is locked out on the day.
              </p>
            </>
          ) : (
            <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900 ring-1 ring-amber-200">
              Connect the door PC first (Doors &amp; access). The list of people appears here within a minute.
            </p>
          )}
        </section>

        <section className={card}>
          {step(
            <Download size={19} />,
            'From Excel',
            'Keep members in a spreadsheet or on paper? Fill in our template and upload it.',
          )}
          <a
            href="/members/import/template"
            className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-[#047857] hover:underline"
          >
            <Download size={14} /> Download the template
          </a>
          <p className="text-xs text-ink-500">
            Columns: First Name, Last Name, Mobile Number, and optionally Member Number, Paid Until and Service. Anyone
            paid up keeps access until their date.
          </p>
          <ExcelImport />
        </section>

        <section className={card}>
          {step(<UserPlus size={19} />, 'One at a time', 'New members joining at the desk: name, mobile, done.')}
          <div>
            <AddMember club={t?.name ?? ''} nextNo={nextNo} variant="primary" />
          </div>
          <p className="text-xs text-ink-500">
            They get the next member number. It’s also their card code and their M-Pesa account number.
          </p>
        </section>
      </div>
    </>
  );
}
