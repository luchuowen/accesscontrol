import 'server-only';
import { createHmac } from 'node:crypto';
import { msisdn } from '@lango/server';
import { cookies } from 'next/headers';
import { sessionSecret } from '@/lib/session';

export const sign = (v: string) =>
  `${v}.${createHmac('sha256', sessionSecret()).update(`member:${v}`).digest('base64url')}`;

/** The phone being signed in with, between the steps (kept out of the address bar). */
export const PHONE = 'lango_member_phone';
/** Several clubs: the memberships the code was right for, signed, while the member picks one. */
export const PICK = 'lango_member_pick';
export const short = { httpOnly: true, sameSite: 'lax' as const, path: '/m', maxAge: 15 * 60 };

export async function pendingPhone(): Promise<string | null> {
  return msisdn((await cookies()).get(PHONE)?.value);
}
export type Pick = { t: string; m: string; c: string; n: number };
export async function pendingPicks(): Promise<Pick[]> {
  const raw = (await cookies()).get(PICK)?.value ?? '';
  const i = raw.lastIndexOf('.');
  if (i < 0 || sign(raw.slice(0, i)) !== raw) return [];
  try {
    return JSON.parse(Buffer.from(raw.slice(0, i), 'base64url').toString()) as Pick[];
  } catch {
    return [];
  }
}
