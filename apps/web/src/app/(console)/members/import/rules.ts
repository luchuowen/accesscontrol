/**
 * Excel import rules, shared by the preview (in the browser, live as rows are edited) and the import itself (on the
 * server, which checks again before anything is written). Same pattern as NAVAC CRM's client import: stage every row,
 * flag what would be skipped, let the owner fix or remove rows, then import.
 */

export const W26_MAX = 65535;
export const POOL = [11001, 11999] as const;
export const MAX_ROWS = 3000;

/** One staged row. Strings throughout so the preview can edit them freely. */
export type Draft = {
  key: number;
  line: number;
  first: string;
  last: string;
  phone: string;
  no: string;
  /** yyyy-mm-dd, or '' */
  until: string;
  /** What the file said when the date could not be read; cleared once the date is edited. */
  badDate?: string;
  service: string;
};

export type Known = { phones: string[]; numbers: number[]; services: string[] };

export const kePhone = (raw: string) => {
  const d = raw.replace(/\D/g, '').replace(/^254/, '').replace(/^0/, '');
  return /^[17]\d{8}$/.test(d) ? `+254${d}` : null;
};

export type Check = { skip: string | null; notes: string[] };

/**
 * Check every row against the club and against the rest of the file. A `skip` reason means the row is not imported
 * until fixed; notes are information only (e.g. a new member number will be given).
 */
export function checkDrafts(rows: Draft[], known: Known, today: string): Check[] {
  const phones = new Set(known.phones);
  const numbers = new Set(known.numbers);
  const svc = new Set(known.services.map((s) => s.toLowerCase()));
  const seenPhone = new Set<string>();
  const seenNo = new Set<number>();
  return rows.map((r) => {
    const notes: string[] = [];
    let skip: string | null = null;
    const phone = r.phone.trim() ? kePhone(r.phone) : null;
    const no = r.no.trim() ? Number(r.no.replace(/\D/g, '')) : null;
    if (!r.first.trim() && !r.last.trim()) skip = 'Add a name';
    else if (r.phone.trim() && !phone) skip = 'Mobile number not recognised';
    else if (phone && phones.has(phone)) skip = 'Already a member with this mobile';
    else if (phone && seenPhone.has(phone)) skip = 'Same mobile as a row above';
    else if (r.badDate) skip = `Paid-until date “${r.badDate}” not understood`;
    if (!skip) {
      if (phone) seenPhone.add(phone);
      if (no !== null) {
        if (!no || no > W26_MAX || (no >= POOL[0] && no <= POOL[1]))
          notes.push(`Number ${r.no} can’t be used, a new one is given`);
        else if (numbers.has(no) || seenNo.has(no)) notes.push(`Number ${no} is taken, a new one is given`);
        else seenNo.add(no);
      }
      if (r.until && r.until > today) {
        if (!r.service) notes.push('Pick a service to keep their access');
        else if (!svc.has(r.service.toLowerCase())) notes.push(`No service called “${r.service}”`);
      } else if (r.until) notes.push('Paid-until date has passed: no access until they pay');
      if (!r.phone.trim()) notes.push('No mobile: they won’t get SMS reminders');
    }
    return { skip, notes };
  });
}
