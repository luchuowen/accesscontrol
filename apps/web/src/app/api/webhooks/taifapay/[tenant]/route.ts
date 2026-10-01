import { handleTaifaWebhook } from '@lango/server';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';
export async function POST(req: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTaifaWebhook(db(), req, (await ctx.params).tenant);
}
