import { withTenant } from '@lango/db';
import ExcelJS from 'exceljs';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

/**
 * The Excel import template, built the NAVAC CRM way: a "How to use" sheet, then a Members sheet with dark headings,
 * a note on every heading, the club's own services as a dropdown, a date picker rule on Paid Until and the mobile
 * column kept as text (so 07… numbers keep their leading 0). No sample rows on the Members sheet, so an example can
 * never be imported as a real member by mistake.
 */
const FONT = 'Inter';
const ink = 'FF0F172A';
const line = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
const border = { top: line, bottom: line, left: line, right: line };
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

export async function GET() {
  const s = await requireSession();
  const [services, [t]] = await Promise.all([
    withTenant(db(), s.tid, (tx) => tx<{ name: string }[]>`select name from services where active order by created_at`),
    db()<{ name: string }[]>`select name from tenants where id = ${s.tid}`,
  ]);
  const names = services.map((x) => x.name);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lango';

  // ---- How to use ----
  const how = wb.addWorksheet('How to use', { views: [{ showGridLines: false }] });
  how.getColumn('A').width = 3;
  how.getColumn('B').width = 30;
  how.getColumn('C').width = 90;
  how.mergeCells('B2:C2');
  const title = how.getCell('B2');
  title.value = `${t?.name ?? 'Your club'} · Members import`;
  title.font = { name: FONT, size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = fill('FF0B1629');
  title.alignment = { vertical: 'middle', indent: 1 };
  how.getRow(2).height = 42;
  const section = (row: number, text: string) => {
    how.mergeCells(`B${row}:C${row}`);
    const c = how.getCell(`B${row}`);
    c.value = text;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = fill(ink);
    c.alignment = { vertical: 'middle', indent: 1 };
    how.getRow(row).height = 28;
  };
  const pair = (row: number, k: string, v: string) => {
    const a = how.getCell(`B${row}`);
    const b = how.getCell(`C${row}`);
    a.value = k;
    b.value = v;
    a.font = { name: FONT, size: 10, bold: true, color: { argb: ink } };
    b.font = { name: FONT, size: 10, color: { argb: 'FF475569' } };
    a.fill = fill('FFF1F5F9');
    a.border = border;
    b.border = border;
    a.alignment = { vertical: 'middle', indent: 1 };
    b.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    how.getRow(row).height = 34;
  };
  section(4, 'HOW TO FILL IT IN');
  pair(
    5,
    '1. Open the Members sheet',
    'One member per row. Start on row 2, under the headings. Don’t rename the headings.',
  );
  pair(6, '2. Name and mobile', 'First Name is required. Add the mobile so they get M-Pesa prompts and renewal SMS.');
  pair(
    7,
    '3. Already paid?',
    'Fill in Paid Until and pick the Service. They keep access to that service until that date.',
  );
  pair(
    8,
    '4. Save and upload',
    'Save as .xlsx, then upload it in Lango: Members › Import › From Excel. You check every row before anything is added.',
  );
  section(10, 'RULES');
  pair(
    11,
    'Mobile Number',
    'Kenyan mobile, e.g. 0712 345 678 or +254 712 345 678. Someone already in the club with that mobile is skipped.',
  );
  pair(
    12,
    'Member Number',
    'Optional. Their current card or member number. If it’s taken or blank, Lango gives the next free number.',
  );
  pair(
    13,
    'Paid Until',
    'A date, e.g. 31/12/2026. Leave blank if they haven’t paid: they’re added without access until they pay.',
  );
  pair(
    14,
    'Service',
    names.length
      ? `Pick from the list: ${names.join(', ')}.`
      : 'Add your services in Lango first (Services), then download this template again.',
  );
  section(16, 'EXAMPLE ROW');
  pair(17, 'Jane Wanjiru', `0712 345 678 · paid until 31/12/2026 · ${names[0] ?? 'Gym'}`);

  // ---- Hidden list of services for the dropdown ----
  const lists = wb.addWorksheet('Lists');
  lists.state = 'hidden';
  names.forEach((n, i) => {
    lists.getCell(`A${i + 1}`).value = n;
  });

  // ---- Members ----
  const sh = wb.addWorksheet('Members', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = [
    { header: 'First Name *', width: 18, note: 'Required.' },
    { header: 'Last Name', width: 18, note: 'Surname or other names.' },
    { header: 'Mobile Number', width: 18, note: 'Kenyan mobile, e.g. 0712 345 678. Used for M-Pesa and SMS.' },
    { header: 'Member Number', width: 16, note: 'Optional. Their current card or member number.' },
    { header: 'Paid Until', width: 14, note: 'Optional. Date their current payment runs to, e.g. 31/12/2026.' },
    { header: 'Service', width: 22, note: 'Pick from the list. Needed when Paid Until is filled in.' },
  ];
  sh.columns = cols.map((c) => ({ header: c.header, width: c.width }));
  cols.forEach((c, i) => {
    const cell = sh.getCell(1, i + 1);
    cell.fill = fill(ink);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', indent: 1 };
    cell.border = border;
    cell.note = { texts: [{ font: { name: FONT, size: 9 }, text: c.note }] };
  });
  sh.getRow(1).height = 28;
  sh.getColumn(3).numFmt = '@';
  sh.getColumn(4).numFmt = '@';
  sh.getColumn(5).numFmt = 'dd/mm/yyyy';
  for (let r = 2; r <= 1001; r++) {
    const row = sh.getRow(r);
    row.height = 20;
    for (let c = 1; c <= 6; c++) {
      const cell = row.getCell(c);
      cell.border = border;
      cell.font = { name: FONT, size: 10 };
      if (r % 2 === 1) cell.fill = fill('FFF8FAFC');
    }
    row.getCell(5).dataValidation = {
      type: 'date',
      operator: 'greaterThan',
      allowBlank: true,
      formulae: [new Date(2000, 0, 1)],
      showErrorMessage: true,
      errorTitle: 'Paid Until',
      error: 'Enter a date, e.g. 31/12/2026.',
    };
    if (names.length)
      row.getCell(6).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`Lists!$A$1:$A$${names.length}`],
        showErrorMessage: true,
        errorTitle: 'Service',
        error: 'Pick a service from the list.',
      };
  }
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 2, visibility: 'visible' }];

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="Lango members import.xlsx"',
      'cache-control': 'no-store',
    },
  });
}
