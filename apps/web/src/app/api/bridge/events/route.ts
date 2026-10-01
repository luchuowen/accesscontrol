import { handleEvents } from '@lango/server';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';
export const POST = (req: Request) => handleEvents(db(), req);
