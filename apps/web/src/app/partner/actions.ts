'use server';
import { randomBytes } from 'node:crypto';
import {
  accountEmail,
  encrypt,
  hashPassword,
  msisdn,
  newPairCode,
  type PlatformEmail,
  type PlatformSms,
  Resend,
  ResendError,
  SourceCodeSms,
  sendEmail,
  signSession,
  TaifaAuthError,
  TaifaPay,
} from '@lango/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requirePartner, sessionCookie, sessionSecret } from '@/lib/session';
import { db } from '@/server/db';

/** Open a club's console as its owner (the partner keeps a way back to the clubs list). */
export async function openClub(form: FormData) {
  const s = await requirePartner();
  const tid = String(form.get('tenantId') ?? '');
  const [c] = await db()<{ id: string }[]>`select id from app_partner_clubs(${s.uid}) where id = ${tid}`;
  if (!c) redirect('/partner');
  const token = signSession({ uid: s.uid, tid: c.id, role: 'owner', name: s.name, partner: true }, sessionSecret());
  (await cookies()).set(...sessionCookie(token));
  redirect('/');
}

export interface CreateClubState {
  error?: string;
  done?: { name: string; slug: string; ownerEmail: string; tempPassword: string; pairCode: string; tenantId: string };
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'club';

// Readable one-time password: no look-alike characters; the owner changes it after first sign-in.
const tempPassword = () => {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return [...randomBytes(14)].map((b) => a[b % a.length]).join('');
};

/** One form → a ready club: tenant, site, pairing code for the Site Bridge, owner login. */
export async function createClub(_prev: CreateClubState, form: FormData): Promise<CreateClubState> {
  const s = await requirePartner();
  const name = String(form.get('name') ?? '')
    .trim()
    .slice(0, 80);
  const ownerName = String(form.get('ownerName') ?? '')
    .trim()
    .slice(0, 80);
  const ownerEmail = String(form.get('ownerEmail') ?? '')
    .trim()
    .toLowerCase();
  const timezone = String(form.get('timezone') ?? 'Africa/Nairobi');
  if (name.length < 2) return { error: 'Enter the club’s name.' };
  if (!ownerName) return { error: 'Enter the name of the club’s owner or manager.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) return { error: 'Enter a valid email for the owner.' };
  const base = slugify(String(form.get('slug') ?? '') || name);
  const taken = new Set(
    (await db()<{ slug: string }[]>`select slug from tenants where slug like ${`${base}%`}`).map((r) => r.slug),
  );
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  const [exists] = await db()<{ id: string }[]>`select id from app_staff_login(${ownerEmail})`;
  if (exists) return { error: 'That email already has a Lango account. Use another email for this club’s owner.' };
  const pw = tempPassword();
  const pairCode = newPairCode();
  try {
    const [row] = await db()<{ id: string }[]>`
      select app_create_club(${s.uid}, ${slug}, ${name}, ${timezone}, ${ownerEmail}, ${ownerName},
                             ${await hashPassword(pw)}, ${pairCode}, ${randomBytes(32).toString('hex')}) as id`;
    return { done: { name, slug, ownerEmail, tempPassword: pw, pairCode, tenantId: row?.id as string } };
  } catch (e) {
    console.error('create club failed', (e as Error).message);
    return { error: 'The club could not be created. Try again, or use a different club code.' };
  }
}

const platformOnly = async () => {
  const s = await requirePartner();
  const [p] = await db()<{ ok: boolean }[]>`select app_is_platform(${s.uid}) as ok`;
  if (!p?.ok) redirect('/partner');
  return s;
};
/** Back to the Platform settings section that was saved, with its notice. */
const SECTION: Record<string, string> = {
  email: 'email',
  sms: 'sms',
  taifa: 'payments',
  billing: 'billing',
  alerts: 'alerts',
  club: 'pricing',
  grant: 'pricing',
};
const back = (k: string): never => redirect(`/partner/settings?m=${k}#${SECTION[k.split('-')[0] ?? ''] ?? 'sms'}`);
const backPartners = (k: string): never => redirect(`/partner/partners?m=${k}`);

/** Platform SMS account (Source Code): key checked against Source Code before it is stored, encrypted. */
export async function savePlatformSms(form: FormData) {
  const s = await platformOnly();
  const apiKey = String(form.get('apiKey') ?? '').trim();
  const sender =
    String(form.get('sender') ?? 'NAVAC')
      .trim()
      .slice(0, 11) || 'NAVAC';
  const costKes = Number(form.get('costKes') ?? 0.5);
  const priceKes = Number(form.get('priceKes') ?? 1);
  if (!(costKes > 0) || !(priceKes > 0)) back('sms-price');
  const [cur] = await db()<{ data: PlatformSms | null }[]>`select app_platform_get('sms') as data`;
  let stored = cur?.data?.apiKey ?? null;
  if (apiKey) {
    let ok = false;
    try {
      ok = (await new SourceCodeSms(apiKey, sender).profile()).ok;
    } catch {
      back('sms-unreachable');
    }
    if (!ok) back('sms-rejected');
    stored = encrypt(apiKey);
  }
  if (!stored) back('sms-missing');
  // Alert settings live in the same record and are kept as they are.
  const { alertPhone, lowCredit } = cur?.data ?? {};
  await db()`select app_platform_set(${s.uid}, 'sms', ${db().json({ apiKey: stored, sender, costKes, priceKes, alertPhone, lowCredit } as never)})`;
  back('sms-ok');
}

/** NAVAC's own alerts: phone, and the Source Code credit level that triggers a warning. */
export async function savePlatformAlerts(form: FormData) {
  const s = await platformOnly();
  const [cur] = await db()<{ data: PlatformSms | null }[]>`select app_platform_get('sms') as data`;
  if (!cur?.data?.apiKey) back('alerts-sms');
  const raw = String(form.get('alertPhone') ?? '').trim();
  const alertPhone = msisdn(raw) ?? undefined;
  if (raw && !alertPhone) back('alerts-phone');
  const lowCredit = Math.max(0, Number(String(form.get('lowCredit') ?? '').replace(/[,\s]/g, '')) || 0) || undefined;
  await db()`select app_platform_set(${s.uid}, 'sms', ${db().json({ ...cur?.data, alertPhone, lowCredit } as never)})`;
  back('alerts-ok');
}

/**
 * NAVAC's Resend account for every Lango email. The key is checked with Resend before it is stored (encrypted);
 * a blank key field keeps the stored one. The sending address must be on a domain the account has.
 */
export async function savePlatformEmail(form: FormData) {
  const s = await platformOnly();
  const apiKey = String(form.get('apiKey') ?? '').trim();
  const fromName =
    String(form.get('fromName') ?? 'Lango')
      .trim()
      .slice(0, 60) || 'Lango';
  const fromAddress = String(form.get('fromAddress') ?? '')
    .trim()
    .toLowerCase();
  const replyTo =
    String(form.get('replyTo') ?? '')
      .trim()
      .toLowerCase() || undefined;
  const webhookSecret = String(form.get('webhookSecret') ?? '').trim();
  const emailRe = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;
  if (!emailRe.test(fromAddress)) back('email-from');
  if (replyTo && !emailRe.test(replyTo)) back('email-reply');
  const [cur] = await db()<{ data: PlatformEmail | null }[]>`select app_platform_get('email') as data`;
  let stored = cur?.data?.apiKey ?? null;
  if (apiKey) {
    if (!apiKey.startsWith('re_')) back('email-key');
    let domains: { name: string; status: string }[] | null = null;
    try {
      domains = await new Resend(apiKey).domains();
    } catch (e) {
      back(e instanceof ResendError && (e.status === 401 || e.status === 403) ? 'email-rejected' : 'email-unreachable');
    }
    if (domains && !domains.some((d) => d.name === fromAddress.split('@')[1])) back('email-domain');
    stored = encrypt(apiKey);
  }
  if (!stored) back('email-missing');
  if (webhookSecret && !webhookSecret.startsWith('whsec_')) back('email-secret');
  const data: PlatformEmail = {
    apiKey: stored as string,
    from: `${fromName} <${fromAddress}>`,
    ...(replyTo ? { replyTo } : {}),
    ...(webhookSecret
      ? { webhookSecret: encrypt(webhookSecret) }
      : cur?.data?.webhookSecret
        ? { webhookSecret: cur.data.webhookSecret }
        : {}),
  };
  await db()`select app_platform_set(${s.uid}, 'email', ${db().json(data as never)})`;
  back('email-ok');
}

/** Send one test email to the signed-in admin's own address and report Resend's answer. */
export async function sendPlatformTestEmail() {
  const s = await platformOnly();
  const [me] = await db()<{ email: string; name: string }[]>`select email, name from app_staff_get(${s.uid})`;
  if (!me) return back('email-missing');
  const mail = accountEmail({
    heading: 'Lango email is working',
    paragraphs: [
      `Hi ${me.name.split(' ')[0]},`,
      "This test was sent from the Lango SaaS console through NAVAC's Resend account. Invitations, password resets, receipts and invoices will arrive the same way.",
    ],
  });
  const ok = await sendEmail(db(), {
    to: me.email,
    subject: 'Lango test email',
    ...mail,
    kind: 'test',
    key: `test:${s.uid}:${Date.now()}`,
  });
  back(ok ? 'email-test-sent' : 'email-test-failed');
}

/** NAVAC's billing details on SMS invoices and receipts. */
export async function savePlatformBilling(form: FormData) {
  const s = await platformOnly();
  const f = (k: string, n = 120) =>
    String(form.get(k) ?? '')
      .trim()
      .slice(0, n) || undefined;
  const billing = {
    name: f('name', 80),
    address: f('address'),
    pin: f('pin', 20),
    email: f('email'),
    phone: f('phone', 20),
  };
  if (!billing.name) back('billing-name');
  await db()`select app_platform_set(${s.uid}, 'billing', ${db().json(billing as never)})`;
  back('billing-ok');
}

/** NAVAC's own TaifaPay merchant keys: SMS credit purchases are paid here. */
export async function savePlatformTaifa(form: FormData) {
  const s = await platformOnly();
  const env = form.get('env') === 'sandbox' ? 'sandbox' : 'live';
  const clientId = String(form.get('clientId') ?? '').trim();
  const clientSecret = String(form.get('clientSecret') ?? '').trim();
  if (!clientId || !clientSecret) back('taifa-missing');
  try {
    await new TaifaPay({ env, clientId, clientSecret }).verify();
  } catch (e) {
    back(e instanceof TaifaAuthError ? 'taifa-rejected' : 'taifa-unreachable');
  }
  await db()`select app_platform_set(${s.uid}, 'taifapay', ${db().json({ env, clientId, clientSecret: encrypt(clientSecret) } as never)})`;
  back('taifa-ok');
}

/** A club's sender ID and SMS price (blank = platform defaults). */
export async function saveClubSms(form: FormData) {
  const s = await platformOnly();
  const tenantId = String(form.get('tenantId') ?? '');
  const sender = String(form.get('sender') ?? '')
    .trim()
    .slice(0, 11);
  const priceRaw = String(form.get('priceKes') ?? '').trim();
  const price = priceRaw ? Number(priceRaw) : null;
  if (price !== null && !(price > 0)) back('club-price');
  await db()`select app_platform_set_club_sms(${s.uid}, ${tenantId}, ${sender}, ${price})`;
  back('club-ok');
}

/** Free or corrective SMS units for a club, always with a note (shows in the ledger). */
export async function grantSms(form: FormData) {
  const s = await platformOnly();
  const tenantId = String(form.get('tenantId') ?? '');
  const units = Number(form.get('units') ?? 0);
  const note = String(form.get('note') ?? '')
    .trim()
    .slice(0, 200);
  if (!Number.isInteger(units) || units === 0 || Math.abs(units) > 1_000_000 || note.length < 3) back('grant-invalid');
  await db()`select app_platform_grant_sms(${s.uid}, ${tenantId}, ${units}, ${note})`;
  back('grant-ok');
}

export async function setPartnerActive(form: FormData) {
  const s = await platformOnly();
  const id = String(form.get('staffId') ?? '');
  const active = form.get('active') === 'true';
  if (id === s.uid) backPartners('self');
  await db()`select app_platform_set_partner_active(${s.uid}, ${id}, ${active})`;
  backPartners(active ? 'partner-on' : 'partner-off');
}

export interface AddPartnerState {
  error?: string;
  done?: { name: string; email: string; tempPassword: string };
}

/** A login for an installer company (sees only its own clubs) or another NAVAC admin. */
export async function addPartner(_prev: AddPartnerState, form: FormData): Promise<AddPartnerState> {
  const s = await platformOnly();
  const name = String(form.get('name') ?? '')
    .trim()
    .slice(0, 80);
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const company = String(form.get('company') ?? '')
    .trim()
    .slice(0, 80);
  if (!name || !company) return { error: 'Enter the person’s name and their company.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email.' };
  const [taken] = await db()<{ id: string }[]>`select id from app_staff_login(${email})`;
  if (taken) return { error: 'That email already has a Lango account.' };
  const pw = tempPassword();
  await db()`select app_platform_add_partner(${s.uid}, ${company}, ${name}, ${email}, ${await hashPassword(pw)})`;
  return { done: { name, email, tempPassword: pw } };
}
