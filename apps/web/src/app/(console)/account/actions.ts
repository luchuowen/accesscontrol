'use server';
import {
  changedPasswordAftermath,
  clientIp,
  hashPassword,
  logAuth,
  msisdn,
  passwordProblem,
  rateLimit,
  staffById,
  verifyPassword,
} from '@lango/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireSignedIn, sessionToken } from '@/lib/session';
import { db } from '@/server/db';

/** The account page lives in the club console and in the partner console; answers go back to the same one. */
async function caller(form: FormData) {
  const s = await requireSignedIn();
  const home = s.partner && form.get('from') === 'partner' ? '/partner/account' : '/account';
  const back = (m: string): never => redirect(`${home}?m=${m}`);
  return { s, back };
}

/** Every account change needs the current password, so a borrowed session cannot take the account over. */
async function provePassword(uid: string, password: string, back: (m: string) => never) {
  if (!rateLimit(`pw-change:${uid}`, 5, 15 * 60_000)) back('wait');
  const [row] = await db()<{ h: string | null }[]>`select app_staff_hash(${uid}) as h`;
  if (!row?.h || !(await verifyPassword(password, row.h))) back('wrong');
}

const PW_CODE: [RegExp, string][] = [
  [/at least 10/, 'short'],
  [/at most/, 'long'],
  [/too easy/, 'guessable'],
  [/breach/, 'breached'],
];

/** Change your own password: this session stays, every other session and remembered device ends. */
export async function changePassword(form: FormData) {
  const { s, back } = await caller(form);
  await provePassword(s.uid, String(form.get('current') ?? ''), back);
  const next = String(form.get('next') ?? '');
  if (next !== String(form.get('confirm') ?? next)) back('mismatch');
  const problem = await passwordProblem(next, s.email);
  if (problem) back(PW_CODE.find(([re]) => re.test(problem))?.[1] ?? 'guessable');
  await db()`select app_set_password(${s.uid}, ${await hashPassword(next)})`;
  const me = await staffById(db(), s.uid);
  if (me) await changedPasswordAftermath(db(), me, 'password-changed', await sessionToken());
  await logAuth(db(), {
    kind: 'password.changed',
    staffId: s.uid,
    tenantId: s.tid || null,
    ip: clientIp(await headers()),
  });
  back('pw-ok');
}

/** Your mobile number: where sign-in codes go. */
export async function savePhone(form: FormData) {
  const { s, back } = await caller(form);
  await provePassword(s.uid, String(form.get('current') ?? ''), back);
  const phone = msisdn(String(form.get('phone') ?? ''));
  if (!phone) back('phone');
  await db()`select app_staff_set_phone(${s.uid}, ${phone})`;
  await logAuth(db(), {
    kind: 'phone.changed',
    staffId: s.uid,
    tenantId: s.tid || null,
    ip: clientIp(await headers()),
  });
  back('phone-ok');
}

/** End one of your other sessions (a browser you no longer use). */
export async function endSession(form: FormData) {
  const { s, back } = await caller(form);
  const id = String(form.get('sid') ?? '');
  if (id === s.sid) back('this');
  await db()`update auth_sessions set revoked_at = now(), revoked_reason = 'signed-out'
             where id = ${/^[0-9a-f-]{36}$/.test(id) ? id : null} and staff_id = ${s.uid} and revoked_at is null`;
  back('ended');
}

export type ProfileState = { error?: string; saved?: number };

/**
 * Your account card: display name, photo and appearance, for yourself only. Name and look are not security
 * settings, so no password is asked (sign-in details stay on the Password & devices page).
 */
export async function saveProfile(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const s = await requireSignedIn();
  const name = String(form.get('name') ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const theme = String(form.get('theme') ?? 'system');
  const photo = String(form.get('avatar') ?? 'keep');
  if (name.length < 2) return { error: 'Enter your name (at least 2 letters).' };
  if (name.length > 80) return { error: 'Keep your name under 80 characters.' };
  if (!['light', 'dark', 'system'].includes(theme)) return { error: 'Pick light, dark or system.' };
  let avatar: string | null = null; // keep
  if (photo === 'remove') avatar = '';
  else if (photo !== 'keep') {
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo) || photo.length > 90_000)
      return { error: 'That photo could not be used. Try a JPG or PNG.' };
    avatar = photo;
  }
  await db()`select app_staff_set_profile(${s.uid}, ${name}, ${theme}, ${avatar})`;
  return { saved: Date.now() };
}
