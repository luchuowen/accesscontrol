import { randomBytes } from 'node:crypto';
import { connect, migrate, withTenant } from '@lango/db';
import { DateTime } from 'luxon';
import { rebuildAccessState } from './access.js';
import { hashPassword } from './auth.js';
import { newPairCode } from './bridge-api.js';
import { recordPayment } from './payments.js';

/**
 * Demo tenant mirroring one of John's clubs: gym, sauna, pool, spa doors; John's numbering (2xxxx monthly
 * members, 11xxx walk-in wristbands); realistic payment history so dashboards are alive. Idempotent per slug.
 */
export interface SeedOptions {
  ownerUrl: string;
  appUrl: string;
  slug?: string;
  name?: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerName?: string;
  /** also create a NAVAC admin login (same password) for the partner console */
  adminEmail?: string;
  adminName?: string;
  readers?: Record<string, number[]>; // zone → AxTraxNG reader IDs (fake defaults 11..14)
  historyDays?: number;
}

const FIRST = [
  'Jane',
  'Brian',
  'Wanjiku',
  'Otieno',
  'Achieng',
  'Kevin',
  'Mercy',
  'Kipchoge',
  'Amina',
  'David',
  'Faith',
  'Mwangi',
  'Njeri',
  'Hassan',
  'Grace',
  'Omondi',
  'Wairimu',
  'Collins',
  'Zawadi',
  'Peter',
  'Akinyi',
  'Samuel',
  'Nafula',
  'Ian',
];
const LAST = [
  'Wanjiru',
  'Kamau',
  'Mutua',
  'Ochieng',
  'Atieno',
  'Kiprop',
  'Njoroge',
  'Chebet',
  'Abdi',
  'Mwende',
  'Wekesa',
  'Muthoni',
  'Odhiambo',
  'Nyambura',
  'Kiplagat',
  'Barasa',
];

export async function seed(o: SeedOptions) {
  await migrate(o.ownerUrl);
  const owner = connect(o.ownerUrl, 2);
  const app = connect(o.appUrl, 4);
  const slug = o.slug ?? 'demo-club';
  try {
    const existing = await owner`select id from tenants where slug = ${slug}`;
    if (existing.length) return { tenantId: existing[0]?.id as string, created: false };

    const [p] = await owner`insert into partners (name) values ('John · Access Control') returning id`;
    const [t] =
      await owner`insert into tenants (partner_id, slug, name) values (${p?.id}, ${slug}, ${o.name ?? 'Demo Club'}) returning id`;
    const tenantId = t?.id as string;
    const [s] = await owner`insert into sites (tenant_id, name) values (${tenantId}, 'Main Clubhouse') returning id`;
    const pair = newPairCode();
    await owner`insert into bridges (tenant_id, site_id, secret, pair_code, pair_expires_at) values (${tenantId}, ${s?.id}, ${randomBytes(32).toString('hex')}, ${pair}, now() + interval '30 days')`;
    const r = o.readers ?? { gym: [11], sauna: [12], pool: [13], spa: [14] };
    for (const [key, name] of [
      ['gym', 'Gym'],
      ['sauna', 'Sauna'],
      ['pool', 'Swimming Pool'],
      ['spa', 'Spa'],
    ] as const)
      await owner`insert into zones (tenant_id, site_id, key, name, reader_ids) values (${tenantId}, ${s?.id}, ${key}, ${name}, ${r[key] ?? []})`;
    const products: [string, string, number, 'day' | 'month', number, string[]][] = [
      ['membership', 'Gym · 1 month', 5000, 'month', 1, ['gym']],
      ['membership', 'Gym · 6 months', 30000, 'month', 6, ['gym']],
      ['membership', 'Gym · 12 months', 60000, 'month', 12, ['gym']],
      ['bundle', 'All-inclusive · 1 month', 9000, 'month', 1, ['gym', 'sauna', 'pool', 'spa']],
      ['day_pass', 'Gym · day pass', 500, 'day', 1, ['gym']],
      ['day_pass', 'Swimming · day pass', 200, 'day', 1, ['pool']],
      ['addon', 'Sauna · 1 week', 600, 'day', 7, ['sauna']],
      ['day_pass', 'Test · 1 day gym (KES 10)', 10, 'day', 1, ['gym']],
    ];
    for (const [kind, name, price, unit, count, zones] of products)
      await owner`insert into products (tenant_id, kind, name, price_kes, duration_unit, duration_count, zone_keys)
                  values (${tenantId}, ${kind}, ${name}, ${price}, ${unit}, ${count}, ${zones})`;
    // The club's owner (one login, one club) and, optionally, a NAVAC admin login for the partner console.
    const [own] = await owner`insert into staff_users (tenant_id, email, name, role, password_hash, accepted_at)
                values (${tenantId}, ${o.ownerEmail.toLowerCase()}, ${o.ownerName ?? 'Club Owner'}, 'club',
                        ${await hashPassword(o.ownerPassword)}, now()) returning id`;
    await owner`insert into club_memberships (tenant_id, staff_id, role) values (${tenantId}, ${own?.id}, 'owner')`;
    if (o.adminEmail)
      await owner`insert into staff_users (email, name, role, password_hash, accepted_at)
                  values (${o.adminEmail.toLowerCase()}, ${o.adminName ?? 'NAVAC Admin'}, 'partner_admin',
                          ${await hashPassword(o.ownerPassword)}, now())
                  on conflict (email) do nothing`;

    // Members + payment history (deterministic pseudo-random so demos are repeatable).
    let rnd = 42;
    const rand = () => {
      rnd = (rnd * 1103515245 + 12345) % 2147483648;
      return rnd / 2147483648;
    };
    const days = o.historyDays ?? 75;
    const midnight = DateTime.now().setZone('Africa/Nairobi').startOf('day').toMillis();
    const plans = [5000, 5000, 5000, 9000, 30000, 600];
    for (let i = 0; i < 24; i++) {
      const no = 21001 + i;
      const [m] = await owner`insert into members (tenant_id, member_no, first_name, last_name, phone)
        values (${tenantId}, ${no}, ${FIRST[i % FIRST.length] as string}, ${LAST[(i * 7) % LAST.length] as string}, ${`+2547${String(10000000 + i * 137).slice(0, 8)}`}) returning id`;
      await owner`insert into credentials (tenant_id, member_id, card_code) values (${tenantId}, ${m?.id}, ${no})`;
      let at = Date.now() - (days - Math.floor(rand() * 20)) * 86400_000;
      while (at < Date.now() && rand() > 0.12) {
        const amount = plans[Math.floor(rand() * plans.length)] as number;
        await recordPayment(app, tenantId, {
          provider: 'seed',
          providerTxnId: `SEED${no}${at}`,
          amountKes: amount,
          accountRef: String(no),
          paidAt: new Date(at + 7 * 3600_000),
        });
        at += (amount >= 30000 ? 180 : amount === 600 ? 9 : 31) * 86400_000 + Math.floor(rand() * 6) * 86400_000;
      }
      await withTenant(app, tenantId, (tx) => rebuildAccessState(tx, tenantId, m?.id as string));
    }
    // Walk-in wristbands (John: 11xxx), plus day-pass sales.
    for (let i = 0; i < 10; i++) {
      const no = 11001 + i;
      const [m] =
        await owner`insert into members (tenant_id, member_no, first_name, last_name) values (${tenantId}, ${no}, 'Wristband', ${String(i + 1).padStart(2, '0')}) returning id`;
      await owner`insert into credentials (tenant_id, member_id, kind, card_code) values (${tenantId}, ${m?.id}, 'wristband', ${no})`;
    }
    for (let d = days; d >= 0; d--) {
      for (let k = 0; k < Math.floor(rand() * 6); k++) {
        const no = 11001 + Math.floor(rand() * 10);
        await recordPayment(app, tenantId, {
          provider: 'seed',
          providerTxnId: `SEEDW${d}-${k}`,
          amountKes: rand() > 0.5 ? 500 : 200,
          accountRef: String(no),
          paidAt: new Date(Math.min(Date.now(), midnight - d * 86400_000 + (8 + k) * 3600_000)),
        });
      }
    }
    // Door activity for the last 30 days (members with access, peak mornings/evenings).
    const sitesId = s?.id as string;
    let ev = 1;
    for (let d = 30; d >= 1; d--) {
      for (let k = 0; k < 40 + Math.floor(rand() * 40); k++) {
        const hour =
          rand() < 0.6
            ? rand() < 0.5
              ? 6 + Math.floor(rand() * 3)
              : 17 + Math.floor(rand() * 3)
            : 9 + Math.floor(rand() * 8);
        const zone = rand() < 0.7 ? 'gym' : rand() < 0.5 ? 'pool' : rand() < 0.5 ? 'sauna' : 'spa';
        const reader = (r[zone] ?? [11])[0] as number;
        const no = 21001 + Math.floor(rand() * 24);
        await owner`insert into access_events (tenant_id, site_id, axtrax_event_id, at, reader_id, door_id, member_no, card_code, granted)
          values (${tenantId}, ${sitesId}, ${-ev++}, ${new Date(midnight - d * 86400_000 + hour * 3600_000 + Math.floor(rand() * 3600_000))},
                  ${reader}, ${reader - 10}, ${no}, ${no}, ${rand() > 0.08})`;
      }
    }
    return { tenantId, created: true, pairCode: pair };
  } finally {
    await app.end();
    await owner.end();
  }
}
