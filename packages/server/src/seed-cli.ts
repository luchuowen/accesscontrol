import { seed } from './seed.js';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`set ${k}`);
  return v;
};
const r = await seed({
  ownerUrl: need('DATABASE_OWNER_URL'),
  appUrl: need('DATABASE_URL'),
  ownerEmail: need('SEED_OWNER_EMAIL'),
  ownerPassword: need('SEED_OWNER_PASSWORD'),
  ...(process.env.SEED_SLUG ? { slug: process.env.SEED_SLUG } : {}),
  ...(process.env.SEED_NAME ? { name: process.env.SEED_NAME } : {}),
  ...(process.env.SEED_OWNER_NAME ? { ownerName: process.env.SEED_OWNER_NAME } : {}),
  ...(process.env.SEED_ADMIN_EMAIL ? { adminEmail: process.env.SEED_ADMIN_EMAIL } : {}),
  ...(process.env.SEED_ADMIN_NAME ? { adminName: process.env.SEED_ADMIN_NAME } : {}),
});
console.log(JSON.stringify(r));
