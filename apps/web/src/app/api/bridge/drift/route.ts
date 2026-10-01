import { handleDrift } from '@lango/server';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';
export const POST = (req: Request) => handleDrift(db(), req);
