import { can } from '@lango/server';
import ExcelJS from 'exceljs';
import { paymentsBoard } from '@/lib/data';
import { requireSession } from '@/lib/session';

/** Payments export (Excel or CSV) with the same filters as the page. */
export async function GET(req: Request) {
  const s = await requireSession();
  if (!can(s, 'payments.record') && !can(s, 'payments.assign') && !can(s, 'reports.all'))
    return new Response('Forbidden', { status: 403 });
  const u = new URL(req.url);
  const full = can(s, 'reports.all');
  const days = full ? Math.min(366, Math.max(1, Number(u.searchParams.get('p')) || 30)) : 0;
  const b = await paymentsBoard(s.tid, {
    days,
    q: u.searchParams.get('q') ?? '',
    method: u.searchParams.get('m') ?? '',
    status: u.searchParams.get('s') ?? '',
    limit: 20000,
  });
  const head = [
    'Date',
    'Time',
    'Member',
    'Member no.',
    'For',
    'Amount (KES)',
    'Method',
    'Status',
    'Reference',
    'Recorded by',
  ];
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) =>
    d.toLocaleString('en-GB', { ...o, timeZone: 'Africa/Nairobi' });
  const rows = b.rows.map((r) => [
    fmt(r.paid_at, { year: 'numeric', month: '2-digit', day: '2-digit' }),
    fmt(r.paid_at, { hour: '2-digit', minute: '2-digit' }),
    r.member ?? '',
    r.member_no ?? '',
    r.product ?? '',
    r.amount_kes,
    r.channel === 'cash' ? 'Cash' : 'M-Pesa',
    r.status === 'applied' ? 'Applied' : 'Needs sorting',
    r.provider_txn_id,
    r.recorded_by ?? '',
  ]);
  const name = `lango-payments-${new Date().toISOString().slice(0, 10)}`;
  if (u.searchParams.get('f') === 'csv') {
    const esc = (v: unknown) => {
      const t = String(v ?? '');
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    return new Response(`﻿${csv}\r\n`, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}.csv"`,
      },
    });
  }
  const wb = new ExcelJS.Workbook();
  const sh = wb.addWorksheet('Payments', { views: [{ state: 'frozen', ySplit: 1 }] });
  sh.addRow(head);
  for (const r of rows) sh.addRow(r);
  sh.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sh.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  sh.getColumn(6).numFmt = '#,##0';
  [12, 8, 24, 11, 32, 14, 10, 14, 22, 18].forEach((w, i) => {
    sh.getColumn(i + 1).width = w;
  });
  sh.addRow([]);
  const total = sh.addRow(['', '', '', '', 'Total applied', b.totals.total]);
  total.font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${name}.xlsx"`,
    },
  });
}
