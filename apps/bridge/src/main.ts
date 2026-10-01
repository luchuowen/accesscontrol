import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { AxtraxClient } from '@lango/axtrax';
import { Bridge } from './bridge.js';
import { Journal } from './journal.js';

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing ${k}`);
  return v;
};
const dataDir = env('LANGO_DATA', process.platform === 'win32' ? 'C:\\ProgramData\\Lango' : './.lango');
const cloud = env('LANGO_CLOUD');
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
    body: JSON.stringify({ code: env('LANGO_PAIR_CODE'), version: '0.1.0' }),
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

let lastGuard = 0;
for (;;) {
  const t0 = Date.now();
  await bridge.cycle(25).catch((e) => console.error(`cycle: ${(e as Error).message}`));
  if (Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 5000)); // back off when offline
  if (Date.now() - lastGuard > 60_000) {
    lastGuard = Date.now();
    for (const d of await bridge.guard().catch(() => []))
      console.log(`guard member ${d.memberNo}: ${d.changes.join(', ')}`);
  }
}
