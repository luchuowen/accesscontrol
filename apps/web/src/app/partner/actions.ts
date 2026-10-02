'use server';
import { randomBytes } from 'node:crypto';
import { encrypt, hashPassword, newPairCode, SourceCodeSms, signSession } from '@lango/server';
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

/** Platform SMS account (Source Code): key checked against Source Code before it is stored, encrypted. */
export async function savePlatformSms(form: FormData) {
  const s = await requirePartner();
  const apiKey = String(form.get('apiKey') ?? '').trim();
  const sender =
    String(form.get('sender') ?? 'NAVAC')
      .trim()
      .slice(0, 11) || 'NAVAC';
  const [cur] = await db()<{ data: { apiKey?: string } | null }[]>`select app_platform_get('sms') as data`;
  let stored = cur?.data?.apiKey ?? null;
  if (apiKey) {
    let ok = false;
    try {
      ok = (await new SourceCodeSms(apiKey, sender).profile()).ok;
    } catch {
      redirect('/partner/settings?sms=unreachable');
    }
    if (!ok) redirect('/partner/settings?sms=rejected');
    stored = encrypt(apiKey);
  }
  if (!stored) redirect('/partner/settings?sms=missing');
  try {
    await db()`select app_platform_set(${s.uid}, 'sms', ${db().json({ apiKey: stored, sender } as never)})`;
  } catch {
    redirect('/partner/settings?sms=forbidden');
  }
  redirect('/partner/settings?sms=ok');
}
