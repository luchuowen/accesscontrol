import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { AxtraxClient } from '@lango/axtrax';
import { Bridge } from './bridge.js';
import { Journal } from './journal.js';

// NAVAC Bridge. Site settings are written by the installer (AxTraxNG login, pairing code); environment variables win.
// Settings use NAVAC_BRIDGE_* names; the LANGO_* names of the first installs are still read.
const DEFAULT_DATA = process.platform === 'win32' ? 'C:\\ProgramData\\NAVAC Bridge' : './.navac-bridge';
const siteFile = `${process.env.NAVAC_BRIDGE_DATA ?? process.env.LANGO_DATA ?? DEFAULT_DATA}/site.json`;
const site: Record<string, string> = (() => {
  try {
    return JSON.parse(readFileSync(siteFile, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
})();
const env = (k: string, d?: string) => {
  const old = k.replace(/^NAVAC_BRIDGE_/, 'LANGO_');
  const v = process.env[k] ?? process.env[old] ?? site[k] ?? site[old] ?? d;
  if (v === undefined) throw new Error(`missing ${k}`);
  return v;
};
const dataDir = env('NAVAC_BRIDGE_DATA', DEFAULT_DATA);
const cloud = env('NAVAC_BRIDGE_CLOUD');
const credFile = `${dataDir}/bridge.json`;
mkdirSync(dataDir, { recursive: true });

// Single instance: two bridges writing one journal would corrupt it.
const lock = `${dataDir}/bridge.lock`;
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, 'utf8'));
  try {
    if (pid && pid !== process.pid) {
      process.kill(pid, 0);
      console.error(`another bridge (pid ${pid}) is running; exiting`);
      process.exit(0);
    }
  } catch {
    /* stale lock */
  }
}
writeFileSync(lock, String(process.pid));

/** First run: exchange the one-time pairing code for credentials; afterwards reuse them. */
async function credentials(): Promise<{ bridgeId: string; secret: string }> {
  if (existsSync(credFile)) return JSON.parse(readFileSync(credFile, 'utf8'));
  const r = await fetch(`${cloud}/api/bridge/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: env('NAVAC_BRIDGE_PAIR_CODE'), version: '0.1.0' }),
  });
  if (!r.ok) throw new Error(`pairing failed: HTTP ${r.status} ${await r.text()}`);
  const c = (await r.json()) as { bridgeId: string; secret: string };
  writeFileSync(credFile, JSON.stringify(c));
  console.log(`paired as bridge ${c.bridgeId}`);
  return c;
}

const c = await credentials();
const ax = new AxtraxClient({
  baseUrl: env('AXTRAX_URL', 'http://localhost:8080'),
  username: env('AXTRAX_USER'),
  password: env('AXTRAX_PASSWORD'),
});
const bridge = new Bridge(
  { cloudUrl: cloud, bridgeId: c.bridgeId, secret: c.secret },
  ax,
  new Journal(`${dataDir}/journal.json`),
);

// Tamper Guard re-reads every member from AxTraxNG, so it runs every 10 minutes, not every cycle.
const GUARD_MS = 10 * 60_000;
const RESYNC_MS = 60 * 60_000;
// First guard ~3 min after start: AxTraxNG's REST service is still starting right after a reboot.
let lastGuard = Date.now() - GUARD_MS + 3 * 60_000;
let lastResync = Date.now();
const INVENTORY_MS = 6 * 3600_000;
let lastInventory = Date.now();
for (;;) {
  if (Date.now() - lastResync > RESYNC_MS) {
    lastResync = Date.now();
    bridge.requestFullResync();
  }
  if (Date.now() - lastInventory > INVENTORY_MS) {
    lastInventory = Date.now();
    bridge.inventoryWanted = true; // keeps the club's door list and import preview current
  }
  // Wake in time for the next service starting or ending, then switch exactly those members.
  const due = bridge.secondsToNextSwitch();
  const wait = due === null ? 25 : Math.max(1, Math.min(25, Math.ceil(due)));
  const t0 = Date.now();
  await bridge.cycle(wait).catch((e) => console.error(`cycle: ${(e as Error).message}`));
  await bridge.switchDue().catch((e) => console.error(`switch: ${(e as Error).message}`));
  if (Date.now() - t0 < Math.min(2000, wait * 1000))
    await new Promise((r) => setTimeout(r, Math.min(5000, wait * 1000))); // back off when offline
  if (Date.now() - lastGuard > GUARD_MS) {
    lastGuard = Date.now();
    for (const d of await bridge.guard().catch(() => []))
      console.log(`guard member ${d.memberNo}: ${d.changes.join(', ')}`);
  }
}
