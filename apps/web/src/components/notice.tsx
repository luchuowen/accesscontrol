const MESSAGES: Record<string, { tone: 'ok' | 'warn' | 'err'; text: string }> = {
  paid: { tone: 'ok', text: 'Payment recorded. The doors update within seconds.' },
  duplicate: { tone: 'warn', text: 'That payment was already recorded, so nothing was charged twice.' },
  unmatched: {
    tone: 'warn',
    text: 'Payment recorded but not applied (member inactive or plan price changed). It is listed under Payments for review.',
  },
  granted: { tone: 'ok', text: 'Complimentary access granted and logged with your reason.' },
  'card-linked': { tone: 'ok', text: 'Card linked. It works at the doors as soon as the member has a paid plan.' },
  'card-taken': { tone: 'err', text: 'That card is already linked to another member.' },
  card: { tone: 'err', text: 'Card numbers are 1 to 65535 (the number printed on the card or tag).' },
  'prompt-sent': { tone: 'ok', text: 'M-Pesa prompt sent. Access opens automatically once the member approves.' },
  'prompt-failed': { tone: 'err', text: 'M-Pesa could not be reached just now. Try again in a minute.' },
  'no-taifapay': { tone: 'warn', text: 'Connect the club’s TaifaPay account in Settings to send M-Pesa prompts.' },
  phone: { tone: 'err', text: 'Enter a Kenyan mobile number, e.g. 0712 345 678.' },
  reason: { tone: 'err', text: 'Give a short reason for complimentary access.' },
  forbidden: { tone: 'err', text: 'Your role cannot do that. Ask a manager.' },
  invalid: { tone: 'err', text: 'That member, plan or zone could not be found.' },
  names: { tone: 'err', text: 'First and last name are required.' },
  number: { tone: 'err', text: 'Member numbers are 1 to 65535.' },
  taken: { tone: 'err', text: 'That member number is already in use.' },
  assigned: {
    tone: 'ok',
    text: 'Payment assigned. The member’s access is updated and the doors follow within a minute.',
  },
  gone: { tone: 'warn', text: 'That payment was already handled.' },
  'still-unmatched': {
    tone: 'err',
    text: 'Not applied: the member was not found or is inactive, or the amount does not equal that plan’s price.',
  },
  saved: { tone: 'ok', text: 'Saved.' },
  'plan-price': {
    tone: 'err',
    text: 'Another active plan already has that price. Prices must be unique so paybill payments match one plan.',
  },
  'plan-invalid': {
    tone: 'err',
    text: 'Give the plan a name, a price in whole shillings, a duration and at least one zone.',
  },
  'zone-invalid': { tone: 'err', text: 'Give the zone a name (letters and numbers).' },
  'zone-taken': { tone: 'err', text: 'A zone with that name already exists at this site.' },
  'inventory-requested': {
    tone: 'ok',
    text: 'Asked the Site Bridge to read AxTraxNG again. The list updates within a minute while the bridge is online.',
  },
  'pair-new': { tone: 'ok', text: 'New pairing code issued. It is valid for 30 days.' },
};
const TONES = {
  ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  err: 'bg-rose-50 text-rose-700 ring-rose-200',
};

/** One-line result banner for a server action, driven by the `?n=` query parameter. */
export function Notice({ code }: { code?: string }) {
  const m = code ? MESSAGES[code] : undefined;
  if (!m) return null;
  return <div className={`mb-4 rounded-xl p-3 text-sm ring-1 ${TONES[m.tone]}`}>{m.text}</div>;
}
