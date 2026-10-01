#!/usr/bin/env node
// Manifest text gates + context caps. Exit 1 on any failure.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const m = JSON.parse(readFileSync('.factory/manifest.json', 'utf8'));
const fails = [];
const walk = (p, out = []) => {
  if (!existsSync(p)) return out;
  if (statSync(p).isFile()) {
    out.push(p);
    return out;
  }
  for (const e of readdirSync(p)) if (!['node_modules', '.next', 'dist', '.turbo'].includes(e)) walk(join(p, e), out);
  return out;
};
for (const g of m.gates) {
  const re = new RegExp(g.pattern);
  for (const f of g.paths.flatMap((p) => walk(p))) {
    if (!/\.(ts|tsx|mjs|js|sql)$/.test(f) || g.exclude.some((x) => f.includes(x))) continue;
    readFileSync(f, 'utf8')
      .split('\n')
      .forEach((l, i) => {
        if (re.test(l)) fails.push(`gate ${g.name}: ${f}:${i + 1}: ${l.trim()}`);
      });
  }
}
for (const [f, cap] of Object.entries(m.caps)) {
  const n = existsSync(f) ? readFileSync(f, 'utf8').split('\n').length : 0;
  if (n > cap) fails.push(`cap ${f}: ${n} lines > ${cap} — compact into .factory/history/`);
}
if (fails.length) {
  console.error(fails.join('\n'));
  process.exit(1);
}
console.log(`gates ok (${m.gates.length} gates, ${Object.keys(m.caps).length} caps)`);
