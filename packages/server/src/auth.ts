import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, n: number) => Promise<Buffer>;

export async function hashPassword(pw: string): Promise<string> {
  if (pw.length < 10) throw new Error('password must be at least 10 characters');
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, k] = stored.split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const want = Buffer.from(k, 'base64');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), want.length);
  return timingSafeEqual(got, want);
}

export interface Session {
  uid: string; // staff user id
  tid: string; // tenant id
  role: string;
  name: string;
  /** Partner/platform admin (NAVAC, an installer such as John): may open any of their clubs. */
  partner?: boolean;
  exp: number; // epoch seconds
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');

/** Compact signed session token: base64url(json).hmac. */
export function signSession(s: Omit<Session, 'exp'>, secret: string, ttlHours = 12): string {
  const body = b64(JSON.stringify({ ...s, exp: Math.floor(Date.now() / 1000) + ttlHours * 3600 }));
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export function verifySession(token: string | undefined, secret: string): Session | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as Session;
  return s.exp > Date.now() / 1000 ? s : null;
}
