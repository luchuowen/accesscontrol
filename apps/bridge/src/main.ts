import { AxtraxClient } from '@lango/axtrax';
import { Bridge } from './bridge.js';
import { Journal } from './journal.js';

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing ${k}`);
  return v;
};
const dataDir = env('LANGO_DATA', process.platform === 'win32' ? 'C:\\ProgramData\\Lango' : './.lango');
const ax = new AxtraxClient({
  baseUrl: env('AXTRAX_URL', 'http://localhost:8080'),
  username: env('AXTRAX_USER'),
  password: env('AXTRAX_PASSWORD'),
});
const bridge = new Bridge(
  { cloudUrl: env('LANGO_CLOUD'), bridgeId: env('LANGO_BRIDGE_ID'), secret: env('LANGO_BRIDGE_SECRET') },
  ax,
  new Journal(`${dataDir}/journal.json`),
);

let lastGuard = 0;
for (;;) {
  await bridge.cycle(25);
  if (Date.now() - lastGuard > 60_000) {
    lastGuard = Date.now();
    const drift = await bridge.guard();
    for (const d of drift) console.log(`guard member ${d.memberNo}: ${d.changes.join(', ')}`);
  }
}
