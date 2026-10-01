import { migrate } from './index.js';

await migrate(
  process.env.DATABASE_OWNER_URL ?? 'postgres://lango:lango@localhost:5432/lango',
  process.env.LANGO_APP_ROLE ?? 'lango_app',
);
console.log('migrations applied');
