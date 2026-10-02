/** The Excel import template: open it in Excel or Google Sheets, fill it in, save, upload. */
export function GET() {
  const csv = [
    'First Name,Last Name,Mobile Number,Member Number,Paid Until,Service',
    'Jane,Wanjiru,0712345678,,31/12/2026,Gym',
    'Brian,Otieno,0722000111,21050,,',
  ].join('\r\n');
  return new Response(`﻿${csv}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="lango-members-template.csv"',
    },
  });
}
