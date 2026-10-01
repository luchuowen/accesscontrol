import { handleAck } from '@/server/bridge-api';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';
export const POST = (req: Request) => handleAck(db(), req);
