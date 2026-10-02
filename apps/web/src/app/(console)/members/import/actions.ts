'use server';
import { withTenant } from '@lango/db';
import { can, importMembers, rebuildAccessState, STAFF_GROUP } from '@lango/server';
import { DateTime } from 'luxon';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import readXlsxFile from 'read-excel-file/node';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

/**
 * Importing members, the three ways a club starts (2 Oct 2026):
 *  - from the door system: one click, everyone already in AxTraxNG, keeping today's access;
 *  - from Excel (or CSV): clubs on paper or spreadsheets; anyone already paid keeps their access until their date;
 *  - one at a time: the Add member form.
 */

const W26_MAX = 65535;
const POOL = [11001, 11999] as const;

/** Door system: import every member group (staff groups left out), keeping current access + 14 days' grace. */
export async function importFromDoors() {
  const s = await requireSession();
  if (!can(s, 'members.edit')) redirect('/members/import?n=forbidden');
  const site = await withTenant(db(), s.tid, async (tx) => {
    const [row] = await tx<{ id: string; groups: { id: number; name: string }[] | null }[]>`
      select si.id, i.data->'groups' as groups from sites si left join site_inventory i on i.site_id = si.id
      order by si.created_at limit 1`;
    return row;
  });
  if (!site?.groups) redirect('/members/import?n=no-doors');
  const groupIds = site.groups.filter((g) => !STAFF_GROUP.test(g.name)).map((g) => g.id);
  const r = await importMembers(db(), s.tid, { siteId: site.id, graceDays: 14, groupIds, actor: s.uid });
  revalidatePath('/members');
  redirect(`/members/import?doors=${r.created}&withAccess=${r.withAccess}&existing=${r.existing}`);
}

export type ExcelRow = {
  line: number;
  first: string;
  last: string;
  phone: string | null;
  no: number | null;
  until: string | null;
  service: string | null;
  problem: string | null;
};
export type ExcelState = {
  error?: string;
  rows?: ExcelRow[];
  ready?: number;
  done?: { created: number; withAccess: number };
};

const norm = (h: unknown) =>
  String(h ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
const COLS: Record<string, string[]> = {
  first: ['firstname', 'first', 'givenname', 'othernames'],
  last: ['lastname', 'last', 'surname', 'familyname'],
  full: ['name', 'fullname', 'membername', 'names'],
  phone: ['phone', 'mobile', 'mobilenumber', 'phonenumber', 'tel', 'telephone', 'msisdn'],
  no: ['membernumber', 'memberno', 'number', 'no', 'cardnumber', 'card', 'id', 'memberid'],
  until: ['paiduntil', 'expiry', 'expires', 'expirydate', 'enddate', 'validuntil', 'until', 'renewaldate'],
  service: ['service', 'plan', 'package', 'membership', 'membershiptype'],
};
const kePhone = (raw: string) => {
  const d = raw.replace(/\D/g, '').replace(/^254/, '').replace(/^0/, '');
  return /^[17]\d{8}$/.test(d) ? `+254${d}` : null;
};
function parseDate(v: unknown, tz: string): DateTime | null {
  if (v instanceof Date)
    return DateTime.fromJSDate(v, { zone: 'utc' }).setZone(tz, { keepLocalTime: true }).endOf('day');
  const s = String(v ?? '').trim();
  if (!s) return null;
  for (const f of ['d/M/yyyy', 'd-M-yyyy', 'd.M.yyyy', 'yyyy-MM-dd', 'd MMM yyyy', 'd MMMM yyyy', 'd/M/yy']) {
    const d = DateTime.fromFormat(s, f, { zone: tz });
    if (d.isValid) return d.endOf('day');
  }
  return null;
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** Read the file, check every row, and either show the preview or (on confirm) create the members. */
export async function importExcel(_prev: ExcelState, form: FormData): Promise<ExcelState> {
  const s = await requireSession();
  if (!can(s, 'members.edit')) return { error: 'Your role can’t add members.' };
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose an Excel or CSV file.' };
  if (file.size > 5_000_000) return { error: 'That file is too large (5 MB at most).' };
  const buf = Buffer.from(await file.arrayBuffer());
  let grid: unknown[][];
  try {
    grid =
      /\.csv$/i.test(file.name) || file.type === 'text/csv' ? parseCsv(buf.toString('utf8')) : await readXlsxFile(buf);
  } catch {
    return { error: 'We couldn’t read that file. Save it as .xlsx or .csv and try again.' };
  }
  if (grid.length < 2) return { error: 'The file has no member rows under the headings.' };
  if (grid.length > 3001) return { error: 'Up to 3,000 members per file. Split it and import in parts.' };
  const head = (grid[0] ?? []).map(norm);
  const at = (k: string) => head.findIndex((h) => COLS[k]?.includes(h));
  const idx = {
    first: at('first'),
    last: at('last'),
    full: at('full'),
    phone: at('phone'),
    no: at('no'),
    until: at('until'),
    service: at('service'),
  };
  if (idx.first < 0 && idx.full < 0)
    return { error: 'Add a “First Name” (or “Name”) column heading in the first row.' };

  return withTenant(db(), s.tid, async (tx) => {
    const [t] = await tx<{ timezone: string }[]>`select timezone from tenants where id = ${s.tid}`;
    const tz = t?.timezone ?? 'Africa/Nairobi';
    const now = DateTime.now().setZone(tz);
    const services = await tx<
      { id: string; name: string; zone_keys: string[] }[]
    >`select id, name, zone_keys from services where active`;
    const taken = new Set((await tx<{ member_no: number }[]>`select member_no from members`).map((m) => m.member_no));
    const phones = new Set(
      (await tx<{ phone: string }[]>`select phone from members where phone is not null`).map((m) => m.phone),
    );
    const cell = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    const rows: ExcelRow[] = [];
    for (let i = 1; i < grid.length; i++) {
      const r = grid[i] ?? [];
      let first = cell(r, idx.first);
      let last = cell(r, idx.last);
      if (!first && idx.full >= 0) {
        const parts = cell(r, idx.full).split(/\s+/).filter(Boolean);
        first = parts[0] ?? '';
        last = parts.slice(1).join(' ');
      }
      const rawPhone = cell(r, idx.phone);
      const phone = rawPhone ? kePhone(rawPhone) : null;
      const noRaw = cell(r, idx.no).replace(/\D/g, '');
      let no: number | null = noRaw ? Number(noRaw) : null;
      const untilD = idx.until >= 0 ? parseDate(r[idx.until], tz) : null;
      const svcName = cell(r, idx.service);
      const svc = svcName
        ? services.find((x) => x.name.toLowerCase() === svcName.toLowerCase())
        : services.length === 1
          ? services[0]
          : undefined;
      let problem: string | null = null;
      if (!first && !last) problem = 'No name: skipped';
      else if (phone && phones.has(phone)) problem = 'Already a member with this mobile: skipped';
      else {
        const notes: string[] = [];
        if (rawPhone && !phone) notes.push('mobile not recognised, left blank');
        if (no !== null && (no < 1 || no > W26_MAX || (no >= POOL[0] && no <= POOL[1]) || taken.has(no))) {
          notes.push(`number ${no} unavailable, a new one is given`);
          no = null;
        }
        if (idx.until >= 0 && cell(r, idx.until) && !untilD)
          notes.push('paid-until date not understood: no access yet');
        if (untilD && untilD > now && !svc)
          notes.push(svcName ? `no service called “${svcName}”: no access yet` : 'no service given: no access yet');
        problem = notes.length ? notes.join('; ') : null;
      }
      if (no !== null) taken.add(no);
      if (phone && !problem?.endsWith('skipped')) phones.add(phone);
      rows.push({
        line: i + 1,
        first: first.slice(0, 80),
        last: (last || '—').slice(0, 80),
        phone,
        no,
        until: untilD && untilD > now && svc ? untilD.toISO() : null,
        service: untilD && untilD > now && svc ? svc.name : null,
        problem,
      });
    }
    const ok = rows.filter((r) => !r.problem?.endsWith('skipped'));
    if (form.get('confirm') !== '1') return { rows, ready: ok.length };

    // Create: numbers from the file where free, otherwise the next free number from 21001.
    let next = Math.max(21000, ...[...taken].filter((n) => n > POOL[1] && n <= W26_MAX)) + 1;
    let withAccess = 0;
    for (const r of ok) {
      let no = r.no;
      if (no === null) {
        while (taken.has(next)) next++;
        no = next++;
        taken.add(no);
      }
      const [m] = await tx<{ id: string }[]>`
        insert into members (tenant_id, member_no, first_name, last_name, phone)
        values (${s.tid}, ${no}, ${r.first || '—'}, ${r.last}, ${r.phone}) on conflict (tenant_id, member_no) do nothing returning id`;
      if (!m) continue;
      await tx`insert into credentials (tenant_id, member_id, card_code) values (${s.tid}, ${m.id}, ${no})
               on conflict (tenant_id, site_code, card_code) do nothing`;
      const svc = r.service ? services.find((x) => x.name === r.service) : undefined;
      if (svc && r.until) {
        withAccess++;
        for (const z of svc.zone_keys)
          await tx`insert into entitlements (tenant_id, member_id, zone_key, starts_at, ends_at, source, service_id)
                   values (${s.tid}, ${m.id}, ${z}, ${now.toJSDate()}, ${new Date(r.until)}, 'import', ${svc.id})`;
      }
      await rebuildAccessState(tx, s.tid, m.id);
    }
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${s.tid}, ${s.uid}, 'members.imported', 'excel', ${tx.json({ file: file.name, created: ok.length, withAccess } as never)})`;
    revalidatePath('/members');
    return { done: { created: ok.length, withAccess } };
  });
}
