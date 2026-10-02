'use server';
import { withTenant } from '@lango/db';
import { can, importMembers, planImport, rebuildAccessState, STAFF_GROUP } from '@lango/server';
import { DateTime } from 'luxon';
import { revalidatePath } from 'next/cache';
import readXlsxFile, { readSheetNames } from 'read-excel-file/node';
import { z } from 'zod';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';
import { checkDrafts, type Draft, type Known, kePhone, MAX_ROWS, POOL, W26_MAX } from './rules';

/**
 * Importing members (import modal, 2 Oct 2026):
 *  - from the door system: one click, everyone already in AxTraxNG, keeping today's access;
 *  - from Excel (or CSV), the NAVAC CRM way: read the file into staged rows, show them for checking and fixing,
 *    then import in batches with progress and a summary. Anyone already paid keeps their access until their date.
 */

async function doorSite(tid: string) {
  return withTenant(db(), tid, async (tx) => {
    const [row] = await tx<{ id: string; groups: { id: number; name: string }[] | null; timezone: string }[]>`
      select si.id, i.data->'groups' as groups, tn.timezone from sites si
      join tenants tn on tn.id = si.tenant_id left join site_inventory i on i.site_id = si.id
      order by si.created_at limit 1`;
    return row;
  });
}

export type DoorsPreview = { create: number; withAccess: number; existing: number } | null;

/** What a door-system import would do, shown before the owner confirms. Null until the door PC is connected. */
export async function doorsPreview(): Promise<DoorsPreview> {
  const s = await requireSession();
  if (!can(s, 'members.edit')) return null;
  const site = await doorSite(s.tid);
  if (!site?.groups) return null;
  const ids = site.groups.filter((g) => !STAFF_GROUP.test(g.name)).map((g) => g.id);
  return withTenant(db(), s.tid, async (tx) => {
    const plan = await planImport(tx, site.id, site.timezone, 14, ids);
    return {
      create: plan.create.length,
      withAccess: plan.create.filter((c) => c.until).length,
      existing: plan.existing,
    };
  });
}

export type DoorsState = { error?: string; done?: { created: number; withAccess: number; existing: number } };

/** Door system: import every member group (staff groups left out), keeping current access + 14 days' grace. */
export async function importFromDoors(_prev: DoorsState, _form: FormData): Promise<DoorsState> {
  const s = await requireSession();
  if (!can(s, 'members.edit')) return { error: 'Your role can’t add members.' };
  const site = await doorSite(s.tid);
  if (!site?.groups) return { error: 'Connect the door PC first (Doors & access).' };
  const groupIds = site.groups.filter((g) => !STAFF_GROUP.test(g.name)).map((g) => g.id);
  const r = await importMembers(db(), s.tid, { siteId: site.id, graceDays: 14, groupIds, actor: s.uid });
  revalidatePath('/members');
  return { done: { created: r.created, withAccess: r.withAccess, existing: r.existing } };
}

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

async function clubFacts(tid: string) {
  return withTenant(db(), tid, async (tx) => {
    const [[t], services, members] = await Promise.all([
      tx<{ timezone: string }[]>`select timezone from tenants where id = ${tid}`,
      tx<{ id: string; name: string; zone_keys: string[] }[]>`
        select id, name, zone_keys from services where active order by created_at`,
      tx<{ member_no: number; phone: string | null }[]>`select member_no, phone from members`,
    ]);
    const tz = t?.timezone ?? 'Africa/Nairobi';
    const known: Known = {
      services: services.map((x) => x.name),
      phones: members.flatMap((m) => (m.phone ? [m.phone] : [])),
      numbers: members.map((m) => m.member_no),
    };
    return { tz, services, known, today: DateTime.now().setZone(tz).toISODate() ?? '' };
  });
}

export type ReadState = { error?: string; rows?: Draft[]; known?: Known; today?: string; file?: string };

/** Step 1: read the file into staged rows for the preview. Nothing is written. */
export async function readImportFile(form: FormData): Promise<ReadState> {
  const s = await requireSession();
  if (!can(s, 'members.edit')) return { error: 'Your role can’t add members.' };
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose an Excel or CSV file.' };
  if (file.size > 5_000_000) return { error: 'That file is too large (5 MB at most).' };
  if (!/\.(xlsx|csv)$/i.test(file.name)) return { error: 'Use an .xlsx or .csv file.' };
  const buf = Buffer.from(await file.arrayBuffer());
  let grid: unknown[][];
  try {
    if (/\.csv$/i.test(file.name)) grid = parseCsv(buf.toString('utf8').replace(/^﻿/, ''));
    else {
      // Our template opens on a "How to use" sheet; read the Members sheet when there is one.
      const sheets = await readSheetNames(buf).catch(() => [] as string[]);
      const sheet = sheets.find((n) => /member/i.test(n)) ?? sheets[0];
      grid = sheet ? await readXlsxFile(buf, { sheet }) : await readXlsxFile(buf);
    }
  } catch {
    return { error: 'We couldn’t read that file. Save it as .xlsx or .csv and try again.' };
  }
  const isName = (c: unknown) => [...(COLS.first ?? []), ...(COLS.full ?? [])].includes(norm(c));
  const h0 = grid.findIndex((r) => r.some(isName));
  if (h0 < 0) return { error: 'Add a “First Name” (or “Name”) column heading in the first row.' };
  const body = grid.slice(h0 + 1).filter((r) => r.some((c) => String(c ?? '').trim()));
  if (!body.length) return { error: 'The file has no member rows under the headings.' };
  if (body.length > MAX_ROWS) return { error: 'Up to 3,000 members per file. Split it and import in parts.' };
  const head = (grid[h0] ?? []).map(norm);
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
  const club = await clubFacts(s.tid);
  const names = club.known.services;
  const cell = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  const rows: Draft[] = body.map((r, i) => {
    let first = cell(r, idx.first);
    let last = cell(r, idx.last);
    if (!first && idx.full >= 0) {
      const parts = cell(r, idx.full).split(/\s+/).filter(Boolean);
      first = parts[0] ?? '';
      last = parts.slice(1).join(' ');
    }
    const rawUntil = idx.until >= 0 ? r[idx.until] : null;
    const until = parseDate(rawUntil, club.tz);
    const svcName = cell(r, idx.service);
    const service = svcName
      ? (names.find((x) => x.toLowerCase() === svcName.toLowerCase()) ?? svcName)
      : names.length === 1 && until
        ? (names[0] as string)
        : '';
    const rawPhone = cell(r, idx.phone);
    return {
      key: i,
      line: h0 + i + 2,
      first: first.slice(0, 80),
      last: last.slice(0, 80),
      phone: (rawPhone ? (kePhone(rawPhone) ?? rawPhone) : '').slice(0, 40),
      no: cell(r, idx.no).replace(/\D/g, '').slice(0, 10),
      until: until?.toISODate() ?? '',
      badDate: !until && String(rawUntil ?? '').trim() ? String(rawUntil).trim().slice(0, 30) : undefined,
      service: service.slice(0, 80),
    };
  });
  return { rows, known: club.known, today: club.today, file: file.name.slice(0, 120) };
}

const DraftZ = z.object({
  key: z.number(),
  line: z.number(),
  first: z.string().max(80),
  last: z.string().max(80),
  phone: z.string().max(40),
  no: z.string().max(10),
  until: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  badDate: z.string().max(40).optional(),
  service: z.string().max(80),
});

export type ImportResult = { error?: string; created: number; withAccess: number; skipped: number };

/**
 * Step 2: import a batch of staged rows (the modal sends 100 at a time to show progress). Every row is checked
 * again here against the club as it is now; anything flagged is skipped, nothing is trusted from the browser.
 */
export async function importDrafts(input: unknown, file: string): Promise<ImportResult> {
  const none = { created: 0, withAccess: 0, skipped: 0 };
  const s = await requireSession();
  if (!can(s, 'members.edit')) return { error: 'Your role can’t add members.', ...none };
  const parsed = z.array(DraftZ).max(200).safeParse(input);
  if (!parsed.success) return { error: 'Those rows couldn’t be read. Try again.', ...none };
  const rows = parsed.data;
  const club = await clubFacts(s.tid);
  const checks = checkDrafts(rows, club.known, club.today);
  return withTenant(db(), s.tid, async (tx) => {
    const now = DateTime.now().setZone(club.tz);
    const taken = new Set(club.known.numbers);
    let next = Math.max(21000, ...[...taken].filter((n) => n > POOL[1] && n <= W26_MAX)) + 1;
    let created = 0;
    let withAccess = 0;
    let skipped = 0;
    for (const [i, r] of rows.entries()) {
      const c = checks[i];
      if (!c || c.skip) {
        skipped++;
        continue;
      }
      // A number the check didn't flag is free; otherwise the next free number from 21001.
      let no = r.no && !c.notes.some((n) => n.startsWith('Number')) ? Number(r.no) : null;
      if (no === null || taken.has(no)) {
        while (taken.has(next)) next++;
        no = next++;
      }
      taken.add(no);
      const [m] = await tx<{ id: string }[]>`
        insert into members (tenant_id, member_no, first_name, last_name, phone)
        values (${s.tid}, ${no}, ${r.first.trim() || '—'}, ${r.last.trim() || '—'}, ${kePhone(r.phone)})
        on conflict (tenant_id, member_no) do nothing returning id`;
      if (!m) {
        skipped++;
        continue;
      }
      created++;
      await tx`insert into credentials (tenant_id, member_id, card_code) values (${s.tid}, ${m.id}, ${no})
               on conflict (tenant_id, site_code, card_code) do nothing`;
      const svc = club.services.find((x) => x.name.toLowerCase() === r.service.toLowerCase());
      if (svc && r.until > club.today) {
        const ends = DateTime.fromISO(r.until, { zone: club.tz }).endOf('day').toJSDate();
        withAccess++;
        for (const zone of svc.zone_keys)
          await tx`insert into entitlements (tenant_id, member_id, zone_key, starts_at, ends_at, source, service_id)
                   values (${s.tid}, ${m.id}, ${zone}, ${now.toJSDate()}, ${ends}, 'import', ${svc.id})`;
      }
      await rebuildAccessState(tx, s.tid, m.id);
    }
    if (created)
      await tx`insert into audit_log (tenant_id, actor, action, entity, data)
               values (${s.tid}, ${s.uid}, 'members.imported', 'excel', ${tx.json({ file: file.slice(0, 120), created, withAccess } as never)})`;
    revalidatePath('/members');
    return { created, withAccess, skipped };
  });
}
