'use server';
import { randomBytes } from 'node:crypto';
import { withTenant } from '@lango/db';
import {
  accountEmail,
  assignClubs,
  checkWhatsApp,
  clientIp,
  encrypt,
  hashPassword,
  inviteClubOwner,
  inviteStaff,
  isPartnerLevel,
  msisdn,
  newPairCode,
  type PlatformEmail,
  type PlatformSms,
  Resend,
  ResendError,
  resendInvite,
  SourceCodeSms,
  sendEmail,
  setPartnerLoginActive,
  staffByEmail,
  staffById,
  TaifaAuthError,
  TaifaPay,
  teamError,
} from '@lango/server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { publicUrl, requirePartner } from '@/lib/session';
import { db } from '@/server/db';

export interface CreateClubState {
  error?: string;
  done?: {
    name: string;
    slug: string;
    ownerName: string;
    ownerEmail: string;
    emailed: boolean;
    pairCode: string;
    tenantId: string;
  };
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'club';

/** "John Waweru from Trisol" / "Owen Lu from NAVAC Global": how the invitation names who sent it. */
async function inviterName(uid: string, name: string) {
  const [p] = await db()<{ name: string }[]>`
    select p.name from partners p join app_staff_get(${uid}) s on s.partner_id = p.id`;
  return `${name} from ${p?.name ?? 'NAVAC Global'}`;
}

/** One form → a ready club: tenant, site, pairing code for the Site Bridge, and an emailed invitation for the owner. */
export async function createClub(_prev: CreateClubState, form: FormData): Promise<CreateClubState> {
  const s = await requirePartner();
  if (s.kind !== 'partner_admin') return { error: 'Only a partner admin can add clubs.' };
  const name = String(form.get('name') ?? '')
    .trim()
    .slice(0, 80);
  const ownerName = String(form.get('ownerName') ?? '')
    .trim()
    .slice(0, 80);
  const ownerEmail = String(form.get('ownerEmail') ?? '')
    .trim()
    .toLowerCase();
  const ownerPhone = String(form.get('ownerPhone') ?? '').trim();
  const timezone = String(form.get('timezone') ?? 'Africa/Nairobi');
  if (name.length < 2) return { error: 'Enter the club’s name.' };
  if (!ownerName) return { error: 'Enter the name of the club’s owner or manager.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) return { error: 'Enter a valid email for the owner.' };
  if (ownerPhone && !msisdn(ownerPhone))
    return { error: 'Enter the owner’s mobile as 07XX XXX XXX, or leave it blank.' };
  const base = slugify(String(form.get('slug') ?? '') || name);
  const taken = new Set(
    (await db()<{ slug: string }[]>`select slug from tenants where slug like ${`${base}%`}`).map((r) => r.slug),
  );
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  // Someone who already runs another club keeps one login; a partner or NAVAC login cannot own a club.
  const existing = await staffByEmail(db(), ownerEmail);
  if (existing && isPartnerLevel(existing))
    return { error: 'That email belongs to a partner or NAVAC login. Use the club owner’s own email.' };
  const pairCode = newPairCode();
  let tenantId: string;
  try {
    // The owner account starts switched off with an unusable password; the invitation below turns it on.
    const [row] = await db()<{ id: string }[]>`
      select app_create_club(${s.uid}, ${slug}, ${name}, ${timezone}, ${ownerEmail}, ${ownerName},
                             ${await hashPassword(randomBytes(32).toString('base64url'))}, ${pairCode},
                             ${randomBytes(32).toString('hex')}) as id`;
    tenantId = row?.id as string;
  } catch (e) {
    console.error('create club failed', (e as Error).message);
    return { error: 'The club could not be created. Try again, or use a different club code.' };
  }
  let emailed = false;
  try {
    const r = await inviteClubOwner(db(), {
      partnerStaffId: s.uid,
      tenantId,
      baseUrl: publicUrl(),
      phone: ownerPhone || undefined,
      ctx: {
        inviterName: await inviterName(s.uid, s.name),
        to: name,
        roleLabel: 'Owner',
        next: 'Once you accept the invitation, you’ll be able to review your quote and pay the one-time setup fee.',
      },
    });
    emailed = r.emailed;
  } catch (e) {
    console.error('owner invitation failed', (e as Error).message);
  }
  return { done: { name, slug, ownerName, ownerEmail, emailed, pairCode, tenantId } };
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
  const inboundDomain = String(form.get('inboundDomain') ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
  const inboundKey = String(form.get('inboundKey') ?? '').trim();
  if (inboundDomain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(inboundDomain)) back('email-inbound');
  if (inboundKey && !inboundKey.startsWith('re_')) back('email-inbound');
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
    ...(inboundDomain ? { inboundDomain } : {}),
    ...(inboundKey
      ? { inboundKey: encrypt(inboundKey) }
      : inboundDomain && cur?.data?.inboundKey
        ? { inboundKey: cur.data.inboundKey }
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
    eyebrow: 'Test',
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

/** People: a NAVAC admin manages every partner-level login; a partner admin their own company's. */
const peopleManager = async () => {
  const s = await requirePartner();
  if (s.kind !== 'partner_admin') redirect('/partner');
  const [p] = await db()<{ ok: boolean }[]>`select app_is_platform(${s.uid}) as ok`;
  const me = await staffById(db(), s.uid);
  return { s, platform: !!p?.ok, partnerId: me?.partner_id ?? null };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const target = (form: FormData) => {
  const v = String(form.get('staffId') ?? '');
  return UUID.test(v) ? v : backPartners('missing');
};

export async function setPartnerActive(form: FormData) {
  const { s } = await peopleManager();
  const id = target(form);
  if (id === s.uid) backPartners('self');
  const active = form.get('active') === 'true';
  try {
    await setPartnerLoginActive(db(), s.uid, id, active, clientIp(await headers()));
  } catch {
    backPartners('denied');
  }
  backPartners(active ? 'partner-on' : 'partner-off');
}

export interface AddPartnerState {
  error?: string;
  done?: { name: string; email: string; emailed: boolean };
}

const PEOPLE_ROLES = ['partner_admin', 'partner_tech', 'navac_support', 'navac_admin'] as const;

/**
 * Invite a partner-level person. NAVAC admins: partner admins and technicians for any company, NAVAC support,
 * NAVAC admins. Partner admins: admins and technicians for their own company.
 */
export async function addPartner(_prev: AddPartnerState, form: FormData): Promise<AddPartnerState> {
  const { s, platform, partnerId } = await peopleManager();
  const name = String(form.get('name') ?? '')
    .trim()
    .slice(0, 80);
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const phone = String(form.get('phone') ?? '').trim();
  const kind = String(form.get('role') ?? 'partner_admin') as (typeof PEOPLE_ROLES)[number];
  if (!PEOPLE_ROLES.includes(kind)) return { error: 'Choose a role.' };
  if (!platform && !['partner_admin', 'partner_tech'].includes(kind)) return { error: 'Choose a role.' };
  if (!name) return { error: 'Enter the person’s name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email.' };
  if (phone && !msisdn(phone)) return { error: 'Enter their mobile as 07XX XXX XXX, or leave it blank.' };
  const navac = kind === 'navac_support' || kind === 'navac_admin';
  let company = 'NAVAC Global';
  let pid: string | null = null;
  if (!navac) {
    if (platform) {
      company = String(form.get('company') ?? '')
        .trim()
        .slice(0, 80);
      if (!company) return { error: 'Enter their company, e.g. Trisol.' };
      const [p] = await db()<{ id: string }[]>`select app_platform_partner_id(${s.uid}, ${company}) as id`;
      pid = p?.id ?? null;
    } else {
      pid = partnerId;
      const [p] = await db()<{ name: string }[]>`select name from partners where id = ${pid}`;
      company = p?.name ?? company;
    }
  }
  const role = kind === 'navac_admin' ? 'partner_admin' : kind;
  const label =
    kind === 'navac_admin'
      ? 'NAVAC admin'
      : kind === 'navac_support'
        ? 'NAVAC support'
        : kind === 'partner_tech'
          ? 'Technician'
          : 'Partner admin';
  try {
    const r = await inviteStaff(db(), {
      inviterId: s.uid,
      email,
      name,
      phone: phone || undefined,
      role,
      tenantId: null,
      partnerId: pid,
      baseUrl: publicUrl(),
      ctx: {
        inviterName: await inviterName(s.uid, s.name),
        to: company,
        roleLabel: label,
        next:
          kind === 'partner_tech'
            ? 'Once you accept, you’ll see the clubs assigned to you for installation.'
            : kind === 'partner_admin'
              ? 'Once you accept, you can add clubs and invite their owners.'
              : undefined,
      },
    });
    revalidatePath('/partner/partners');
    return { done: { name, email, emailed: r.emailed } };
  } catch (e) {
    return { error: teamError(e) };
  }
}

/** A fresh invitation link (the earlier one stops working). */
export async function resendPartnerInvite(form: FormData) {
  const { s } = await peopleManager();
  const id = target(form);
  const [ok] = await db()<{ ok: boolean }[]>`select app_partner_can_manage(${s.uid}, ${id}) as ok`;
  if (!ok?.ok) backPartners('denied');
  const r = await resendInvite(db(), id, s.uid, publicUrl());
  backPartners(r.ok ? 'invite-sent' : 'invite-failed');
}

/** Which clubs a technician installs and supports. */
export async function assignTechClubs(form: FormData) {
  const { s } = await peopleManager();
  const id = target(form);
  const clubs = form
    .getAll('club')
    .map(String)
    .filter((v) => UUID.test(v));
  try {
    await assignClubs(db(), s.uid, id, clubs, clientIp(await headers()));
  } catch {
    backPartners('denied');
  }
  backPartners('assigned');
}

const backClubs = (m: string): never => redirect(`/partner?m=${m}`);

/** Invite the owner of a club that has none (or whose owner was removed). */
export async function inviteOwner(form: FormData) {
  const s = await requirePartner();
  if (s.kind !== 'partner_admin') backClubs('denied');
  const tenantId = String(form.get('tenantId') ?? '');
  const [c] = await db()<
    { id: string; name: string }[]
  >`select id, name from app_partner_clubs(${s.uid}) where id = ${tenantId}`;
  if (!c) return backClubs('denied');
  const name = String(form.get('name') ?? '')
    .trim()
    .slice(0, 80);
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const phone = String(form.get('phone') ?? '').trim();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) backClubs('owner-details');
  if (phone && !msisdn(phone)) backClubs('owner-phone');
  let outcome = 'owner-failed';
  try {
    const r = await inviteStaff(db(), {
      inviterId: s.uid,
      email,
      name,
      phone: phone || undefined,
      role: 'owner',
      tenantId: c.id,
      baseUrl: publicUrl(),
      ctx: {
        inviterName: await inviterName(s.uid, s.name),
        to: c.name,
        roleLabel: 'Owner',
        next: 'Once you accept the invitation, you’ll be able to review your quote and pay the one-time setup fee.',
      },
    });
    outcome = r.emailed ? 'owner-invited' : 'owner-not-sent';
  } catch (e) {
    const m = (e as Error).message;
    outcome = m.includes('another club')
      ? 'owner-taken'
      : m.includes('partner login')
        ? 'owner-partner'
        : 'owner-failed';
  }
  backClubs(outcome);
}

/** A fresh invitation for a club owner who has not accepted yet. */
export async function resendOwnerInvite(form: FormData) {
  const s = await requirePartner();
  if (s.kind !== 'partner_admin') backClubs('denied');
  const tenantId = String(form.get('tenantId') ?? '');
  const [o] = await db()<{ id: string }[]>`
    select s.id from app_partner_club_owners(${s.uid}) o join app_staff_by_email(o.owner_email) s on true
    where o.tenant_id = ${tenantId} and not o.accepted`;
  if (!o) return backClubs('denied');
  const r = await resendInvite(db(), o.id, s.uid, publicUrl());
  backClubs(r.ok ? 'owner-invited' : 'owner-failed');
}

// ---------- one club: doors and communications ----------

/** The club from the form, if this partner login may work on it. */
async function partnerClub(form: FormData, kinds: string[]) {
  const s = await requirePartner();
  const tenantId = String(form.get('tenantId') ?? '');
  if (!UUID.test(tenantId) || !kinds.includes(s.kind)) redirect('/partner?m=denied');
  const [c] = await db()<{ id: string }[]>`select id from app_partner_clubs(${s.uid}) where id = ${tenantId}`;
  if (!c) redirect('/partner?m=denied');
  return { s, tenantId };
}
const toClub = (tenantId: string, tab: string, n: string): never =>
  redirect(`/partner/clubs/${tenantId}?tab=${tab}&n=${n}`);
const INSTALLERS = ['partner_admin', 'partner_tech'];

/** Installer: which door readers open each area (from the readers the Site Bridge read from AxTraxNG). */
export async function partnerSaveReaders(form: FormData) {
  const { s, tenantId } = await partnerClub(form, INSTALLERS);
  const zoneId = String(form.get('zoneId') ?? '');
  if (!UUID.test(zoneId)) toClub(tenantId, 'doors', 'zone-invalid');
  const readers = [...new Set(form.getAll('readers').map(Number))].filter((n) => Number.isInteger(n) && n > 0);
  await withTenant(db(), tenantId, async (tx) => {
    await tx`update zones set reader_ids = ${readers} where id = ${zoneId}`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${tenantId}, ${s.uid}, 'zone.readers', ${zoneId}, ${tx.json({ readers } as never)})`;
  });
  revalidatePath(`/partner/clubs/${tenantId}`);
  toClub(tenantId, 'doors', 'readers-saved');
}

/** Installer: ask the Site Bridge to read AxTraxNG again on its next sync. */
export async function partnerInventory(form: FormData) {
  const { tenantId } = await partnerClub(form, INSTALLERS);
  const siteId = String(form.get('siteId') ?? '');
  if (!UUID.test(siteId)) toClub(tenantId, 'doors', 'zone-invalid');
  await withTenant(db(), tenantId, (tx) => tx`update sites set inventory_requested_at = now() where id = ${siteId}`);
  revalidatePath(`/partner/clubs/${tenantId}`);
  toClub(tenantId, 'doors', 'inventory');
}

/** Installer: a fresh pairing code, e.g. when the AxTraxNG PC is replaced. */
export async function partnerPairCode(form: FormData) {
  const { s, tenantId } = await partnerClub(form, INSTALLERS);
  await withTenant(db(), tenantId, async (tx) => {
    await tx`select app_reissue_pair_code(${newPairCode()})`;
    await tx`insert into audit_log (tenant_id, actor, action) values (${tenantId}, ${s.uid}, 'bridge.pair_code_reissued')`;
  });
  revalidatePath(`/partner/clubs/${tenantId}`);
  toClub(tenantId, 'doors', 'pair-new');
}

/**
 * Connect the club's WhatsApp Business number (Meta Cloud API). The token is checked with Meta before it is
 * stored (encrypted); blank secrets keep the stored ones.
 */
export async function partnerSaveWhatsApp(form: FormData) {
  const { s, tenantId } = await partnerClub(form, ['partner_admin']);
  const phoneNumberId = String(form.get('phoneNumberId') ?? '').replace(/\D/g, '');
  const accessToken = String(form.get('accessToken') ?? '').trim();
  const appSecret = String(form.get('appSecret') ?? '').trim();
  const enabled = form.get('enabled') === 'on';
  if (!/^\d{6,20}$/.test(phoneNumberId)) toClub(tenantId, 'comms', 'wa-id');
  const [cur] = await db()<{ has_secret: boolean; config: { displayPhone?: string; phoneNumberId?: string } }[]>`
    select has_secret, config from app_partner_channels(${s.uid}, ${tenantId}) where channel = 'whatsapp'`;
  let secret: string | null = null;
  let display = cur?.config?.displayPhone;
  if (accessToken || appSecret) {
    if (!accessToken || !appSecret) toClub(tenantId, 'comms', 'wa-both');
    const check = await checkWhatsApp(phoneNumberId, accessToken);
    if (!check.ok) toClub(tenantId, 'comms', 'wa-rejected');
    else display = check.display;
    secret = encrypt(JSON.stringify({ accessToken, appSecret }));
  } else if (!cur?.has_secret || cur.config?.phoneNumberId !== phoneNumberId) {
    toClub(tenantId, 'comms', 'wa-both');
  }
  await db()`select app_partner_set_channel(${s.uid}, ${tenantId}, 'whatsapp', ${enabled},
             ${db().json({ phoneNumberId, displayPhone: display } as never)}, ${secret})`;
  revalidatePath(`/partner/clubs/${tenantId}`);
  toClub(tenantId, 'comms', 'wa-ok');
}

/** Email under the club's name (sent from NAVAC's Resend account); replies need receiving set up on the platform. */
export async function partnerSaveEmail(form: FormData) {
  const { s, tenantId } = await partnerClub(form, ['partner_admin']);
  const enabled = form.get('enabled') === 'on';
  await db()`select app_partner_set_channel(${s.uid}, ${tenantId}, 'email', ${enabled}, '{}'::jsonb, null)`;
  revalidatePath(`/partner/clubs/${tenantId}`);
  toClub(tenantId, 'comms', 'email-ok');
}

// ---------- one club: payments (NAVAC only) ----------

/**
 * A club's Payment Gateway keys. Only NAVAC sets these, during onboarding: the client ID and secret stay secret
 * from partners and from the club. The keys are checked with the Payment Gateway before they are stored.
 */
export async function navacSaveGateway(form: FormData) {
  const s = await platformOnly();
  const tenantId = String(form.get('tenantId') ?? '');
  if (!UUID.test(tenantId)) redirect('/partner?m=denied');
  const env = String(form.get('env')) === 'sandbox' ? 'sandbox' : 'live';
  const clientId = String(form.get('clientId') ?? '').trim();
  const clientSecret = String(form.get('clientSecret') ?? '').trim();
  if (!clientId || !clientSecret) toClub(tenantId, 'pay', 'gw-missing');
  let outcome: 'ok' | 'rejected' | 'unreachable' = 'ok';
  try {
    await new TaifaPay({ env, clientId, clientSecret }).verify();
  } catch (e) {
    outcome = e instanceof TaifaAuthError ? 'rejected' : 'unreachable';
  }
  if (outcome !== 'ok') toClub(tenantId, 'pay', `gw-${outcome}`);
  await withTenant(db(), tenantId, async (tx) => {
    const data = { taifapay: { env, clientId, clientSecret: encrypt(clientSecret) } };
    await tx`insert into tenant_settings (tenant_id, data) values (${tenantId}, ${tx.json(data as never)})
             on conflict (tenant_id) do update set data = tenant_settings.data || excluded.data`;
    await tx`insert into audit_log (tenant_id, actor, action, data) values (${tenantId}, ${s.uid}, 'settings.taifapay',
             ${tx.json({ env, clientId: `…${clientId.slice(-4)}` } as never)})`;
  });
  revalidatePath(`/partner/clubs/${tenantId}`);
  toClub(tenantId, 'pay', 'gw-ok');
}

/** Where members pay (the club's paybill or till on the Payment Gateway) and the bank it settles to. NAVAC only. */
export async function navacSaveChannels(form: FormData) {
  const s = await platformOnly();
  const tenantId = String(form.get('tenantId') ?? '');
  if (!UUID.test(tenantId)) redirect('/partner?m=denied');
  const code = /^\d{5,7}$/;
  const paybill = String(form.get('paybill') ?? '').replace(/\s/g, '');
  const till = String(form.get('till') ?? '').replace(/\s/g, '');
  if ((paybill && !code.test(paybill)) || (till && !code.test(till))) toClub(tenantId, 'pay', 'ch-number');
  const channels = {
    paybill: paybill || null,
    till: till || null,
    linksOnly: form.get('linksOnly') === 'on',
    settlementBank: String(form.get('settlementBank') ?? '')
      .trim()
      .slice(0, 80),
    settlementConfirmed: form.get('settlementConfirmed') === 'on',
  };
  await withTenant(db(), tenantId, async (tx) => {
    await tx`insert into tenant_settings (tenant_id, data) values (${tenantId}, ${tx.json({ channels } as never)})
             on conflict (tenant_id) do update set data = tenant_settings.data || excluded.data`;
    await tx`insert into audit_log (tenant_id, actor, action, data) values (${tenantId}, ${s.uid}, 'settings.channels',
             ${tx.json(channels as never)})`;
  });
  revalidatePath(`/partner/clubs/${tenantId}`);
  toClub(tenantId, 'pay', 'ch-ok');
}
