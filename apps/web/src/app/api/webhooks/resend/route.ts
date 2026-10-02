import { applyResendEvent, decrypt, platformEmailConfig, receiveEmail, verifySvix } from '@lango/server';
import { db } from '@/server/db';

/**
 * Resend events, signed with Svix (unsigned or stale events are refused): delivery updates (delivered, bounced,
 * complained), and email.received for replies to clubs, which land in the club's Communications inbox.
 */
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
    const evt = JSON.parse(raw);
    if (evt?.type === 'email.received') await receiveEmail(db(), evt.data ?? {});
    else await applyResendEvent(db(), evt);
  } catch {
    return new Response('bad body', { status: 400 });
  }
  return new Response('ok');
}
