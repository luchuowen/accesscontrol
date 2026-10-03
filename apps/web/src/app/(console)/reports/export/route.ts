import { can } from '@lango/server';
import ExcelJS from 'exceljs';
import { PERIODS } from '@/lib/periods';
import { HEAT_FROM, reports } from '@/lib/reports';
import { requireSession } from '@/lib/session';

type Sheet = { name: string; head: string[]; rows: (string | number)[][]; money?: number[] };

/** Reports export: one section (Excel or CSV) or everything (one workbook, a sheet per table). */
export async function GET(req: Request) {
  const s = await requireSession();
  if (!can(s, 'reports.all')) return new Response('Forbidden', { status: 403 });
  const u = new URL(req.url);
  const days = PERIODS.some(([d]) => d === Number(u.searchParams.get('p'))) ? Number(u.searchParams.get('p')) : 30;
  const sec = u.searchParams.get('s') ?? 'all';
  const r = await reports(s.tid, days);
  const m = r.members;
  const summary: Sheet = {
    name: 'Summary',
    head: ['Figure', 'Value'],
    rows: [
      ['Club', r.club],
      ['From', r.from],
      ['To', r.to],
      ['Money in (KES)', r.money.total],
      ['Money in, period before (KES)', r.money.prev],
      ['M-Pesa (KES)', r.money.mpesa],
      ['Cash (KES)', r.money.cash],
      ['Payments', r.money.n],
      ['Active members now', m.active],
      ['Active members at start', m.activeAtStart],
      ['Joined', m.joined],
      ['Plans ended', m.ended],
      ['Renewed', m.renewed],
      ['Renewal rate (%)', m.ended ? Math.round((m.renewed / m.ended) * 100) : ''],
      ['Visits (entries)', r.visits.total],
      ['People who came in', r.visits.people],
      ['Turned away at the door', r.visits.denied],
      ['Walk-in passes sold', r.walkins.passes],
      ['Walk-in money (KES)', r.walkins.kes],
    ],
  };
  const daily: Sheet = {
    name: 'Money per day',
    head: ['Date', 'M-Pesa (KES)', 'Cash (KES)', 'Total (KES)'],
    rows: r.daily.map((d) => [d.day, d.mpesa, d.cash, d.mpesa + d.cash]),
    money: [2, 3, 4],
  };
  const services: Sheet = {
    name: 'By service',
    head: ['Service', 'Sold', 'M-Pesa (KES)', 'Cash (KES)', 'Total (KES)'],
    rows: r.services.map((x) => [x.name, x.sold, x.mpesa, x.cash, x.total]),
    money: [3, 4, 5],
  };
  const members: Sheet = {
    name: 'Active members',
    head: ['Date', 'Active members'],
    rows: r.activeDaily.map((d) => [d.day, d.n]),
  };
  const heat: Sheet = {
    name: 'Busiest times',
    head: ['Day', ...Array.from({ length: r.heat[0]?.length ?? 0 }, (_, i) => `${HEAT_FROM + i}:00`)],
    rows: r.heat.map((row, i) => [['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i] ?? '', ...row]),
  };
  const walk: Sheet = {
    name: 'Walk-ins',
    head: ['Date', 'Passes', 'Money in (KES)'],
    rows: r.walkins.byDay.map((d) => [d.day, d.passes, d.kes]),
    money: [3],
  };
  const sheets =
    sec === 'money'
      ? [daily, services]
      : sec === 'members'
        ? [members, heat]
        : sec === 'walkins'
          ? [walk]
          : [summary, daily, services, members, heat, walk];
  const name = `lango-report-${sec}-${r.from}-to-${r.to}`;
  if (u.searchParams.get('f') === 'csv') {
    const esc = (v: unknown) => {
      // Text starting with = + - @ would run as a formula in Excel.
      const t =
        typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^[+-]?[\d\s.,]+$/.test(v) ? `'${v}` : String(v ?? '');
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = sheets
      .map((sh) => [[sh.name], sh.head, ...sh.rows].map((row) => row.map(esc).join(',')).join('\r\n'))
      .join('\r\n\r\n');
    return new Response(`﻿${csv}\r\n`, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}.csv"`,
      },
    });
  }
  const wb = new ExcelJS.Workbook();
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(sh.head);
    for (const row of sh.rows) ws.addRow(row);
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    sh.head.forEach((h, i) => {
      ws.getColumn(i + 1).width = Math.max(10, h.length + 4, i === 0 ? 24 : 0);
    });
    for (const c of sh.money ?? []) ws.getColumn(c).numFmt = '#,##0';
    if (sh.money) {
      ws.addRow([]);
      const tot = ws.addRow(sh.head.map((_, i) => (i === 0 ? 'Total' : '')));
      for (const c of sh.money) tot.getCell(c).value = sh.rows.reduce((a, row) => a + Number(row[c - 1] ?? 0), 0);
      tot.font = { bold: true };
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${name}.xlsx"`,
    },
  });
}
