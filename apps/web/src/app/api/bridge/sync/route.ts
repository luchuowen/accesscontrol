import { handleSync } from '@lango/server';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';
export const GET = (req: Request) => handleSync(db(), req);
