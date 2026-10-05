import 'server-only';
import { db } from '@/server/db';

/** What the “Add a club” popup needs: the console address to hand over, and (NAVAC only) the partners to pick from. */
export async function addClubProps(uid: string) {
  const consoleUrl = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const [plat] = await db()<{ ok: boolean }[]>`select app_is_platform(${uid}) as ok`;
  const partners = plat?.ok
    ? (
        await db()<{ partner_id: string; partner: string }[]>`select partner_id, partner from app_partner_terms(${uid})`
      ).map((p) => ({ id: p.partner_id, name: p.partner }))
    : [];
  return { consoleUrl, partners };
}
