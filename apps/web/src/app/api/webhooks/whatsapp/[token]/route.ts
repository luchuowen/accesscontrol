import { decrypt, parseMeta, receiveWhatsApp, verifyMeta, type WhatsAppSecret } from '@lango/server';
import { db } from '@/server/db';

/**
 * A club's WhatsApp Business number (Meta Cloud API). The address carries the club's routing token; Meta checks it
 * once with GET (verify token), then signs every POST with the app secret. Unsigned posts are refused; signed ones
 * always get 200 so Meta does not keep resending.
 */
type Ctx = { params: Promise<{ token: string }> };

async function channel(token: string) {
  const [c] = await db()<{ tenant_id: string; secret: string | null; verify_token: string | null; enabled: boolean }[]>`
    select tenant_id, secret, verify_token, enabled from app_channel_by_token(${token})`;
  return c ?? null;
}

export async function GET(req: Request, { params }: Ctx) {
  const c = await channel((await params).token);
  const u = new URL(req.url).searchParams;
  if (!c || u.get('hub.mode') !== 'subscribe' || !c.verify_token || u.get('hub.verify_token') !== c.verify_token)
    return new Response('forbidden', { status: 403 });
  return new Response(u.get('hub.challenge') ?? '', { headers: { 'content-type': 'text/plain' } });
}

export async function POST(req: Request, { params }: Ctx) {
  const c = await channel((await params).token);
  if (!c?.secret) return new Response('not found', { status: 404 });
  const raw = await req.text();
  const sec = JSON.parse(decrypt(c.secret)) as WhatsAppSecret;
  if (!verifyMeta(sec.appSecret, raw, req.headers.get('x-hub-signature-256')))
    return new Response('bad signature', { status: 401 });
  if (!c.enabled) return new Response('ok');
  try {
    await receiveWhatsApp(db(), c.tenant_id, parseMeta(JSON.parse(raw)));
  } catch (e) {
    console.error('whatsapp webhook', (e as Error).message);
  }
  return new Response('ok');
}
