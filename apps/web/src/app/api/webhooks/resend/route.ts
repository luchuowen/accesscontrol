import { applyResendEvent, decrypt, platformEmailConfig, verifySvix } from '@lango/server';
import { db } from '@/server/db';

/** Resend delivery events (delivered, bounced, complained), signed with Svix; unsigned or stale events are refused. */
export async function POST(req: Request) {
  const raw = await req.text();
  const cfg = await platformEmailConfig(db());
  if (!cfg?.webhookSecret) return new Response('not configured', { status: 404 });
  const ok = verifySvix(
    decrypt(cfg.webhookSecret),
    {
      id: req.headers.get('svix-id'),
      timestamp: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
    },
    raw,
  );
  if (!ok) return new Response('bad signature', { status: 401 });
  try {
    await applyResendEvent(db(), JSON.parse(raw));
  } catch {
    return new Response('bad body', { status: 400 });
  }
  return new Response('ok');
}
