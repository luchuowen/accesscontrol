#!/usr/bin/env node
// PreToolUse (Edit|Write|MultiEdit): protected paths, append-only dirs, wasteful whole-file Writes.
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { relative } from 'node:path';
const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const m = JSON.parse(readFileSync(`${root}/.factory/manifest.json`, 'utf8'));
const ti = input.tool_input || {};
const abs = ti.file_path || ti.path || '';
if (!abs) process.exit(0);
const f = relative(root, abs);
const block = (why) => { console.error(`BLOCKED ${f}: ${why}`); process.exit(2); };
if (m.protected.some((p) => f === p || f.startsWith(p))) {
  const ok = (process.env.FACTORY_ALLOW || '').split(',').includes(f);
  if (!ok) block('protected path — owner must name this exact file (FACTORY_ALLOW) to edit it');
}
if (m.append_only_dirs.some((d) => f.startsWith(d))) {
  let inHead = false;
  try { execSync(`git -C "${root}" cat-file -e HEAD:"${f}"`, { stdio: 'ignore' }); inHead = true; } catch {}
  if (inHead) block('append-only directory — add a new file instead of editing a committed one');
}
if (input.tool_name === 'Write' && existsSync(abs) && typeof ti.content === 'string') {
  const old = readFileSync(abs, 'utf8').split('\n');
  if (old.length >= 150) {
    const next = ti.content.split('\n');
    const set = new Set(old);
    const changed = next.filter((l) => !set.has(l)).length + Math.max(0, old.length - next.length);
    if (changed / old.length < 0.25) block(`whole-file Write of ${old.length} lines changing <25% — use Edit`);
  }
}
process.exit(0);
