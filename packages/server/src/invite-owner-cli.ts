/**
 * Operator tool: invite the owner of an existing club, as a NAVAC admin would from the clubs list.
 * Usage: node invite-owner.mjs <admin-email> <club-slug> <owner-email> "<owner name>" [phone]
 * Needs DATABASE_URL, APP_ENCRYPTION_KEY and PUBLIC_URL (from /etc/lango.env).
 */
import { connect } from '@lango/db';
import { inviteStaff, staffByEmail } from './accounts.js';

const [adminEmail, slug, email, name, phone] = process.argv.slice(2);
if (!adminEmail || !slug || !email || !name) {
  console.error('usage: invite-owner <admin-email> <club-slug> <owner-email> "<owner name>" [phone]');
  process.exit(2);
}
const sql = connect(process.env.DATABASE_URL as string, 2);
try {
  const admin = await staffByEmail(sql, adminEmail);
  if (!admin) throw new Error('admin login not found');
  const [club] = await sql<
    { id: string; name: string }[]
  >`select id, name from app_partner_clubs(${admin.id}) where slug = ${slug}`;
  if (!club) throw new Error('club not found for this admin');
  const r = await inviteStaff(sql, {
    inviterId: admin.id,
    email,
    name,
    phone,
    role: 'owner',
    tenantId: club.id,
    baseUrl: (process.env.PUBLIC_URL ?? '').replace(/\/$/, ''),
    ctx: {
      inviterName: `${admin.name} from NAVAC Global`,
      to: club.name,
      roleLabel: 'Owner',
      next: 'Once you accept the invitation, you’ll be able to review your quote and pay the one-time setup fee.',
    },
  });
  console.log(`invited ${email} as owner of ${club.name}: emailed=${r.emailed} texted=${r.texted} added=${r.added}`);
} finally {
  await sql.end();
}
