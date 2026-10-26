/**
 * Lint-style determinism check for simulation code (multiplayer brief, Part B).
 * Runs as part of `npm test`.
 *
 * In src/sim, src/world and src/core/rng.ts it bans:
 *  - wall-clock and real-time APIs (Math.random, Date, performance.now, timers,
 *    requestAnimationFrame, crypto);
 *  - implementation-approximated maths (Math.sin/cos/tan/atan/atan2/exp/log/
 *    pow/hypot/cbrt… and the ** operator): use sim/dmath.ts;
 *  - hidden state (WeakMap, WeakSet, WeakRef; module-level `let`, Map or Set
 *    unless the line says `// det-ok: <why>`);
 *  - reading render, UI, game, audio or browser state (imports from those
 *    folders or from three; window, document, localStorage).
 *
 *   npx vite-node tools/check-determinism.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname ?? __dirname, '..');
const DIRS = ['src/sim', 'src/world'];
const FILES = ['src/core/rng.ts'];

const RULES: Array<{ re: RegExp; why: string; except?: RegExp }> = [
  { re: /\bMath\.random\b/, why: 'Math.random: use the seeded w.rng' },
  { re: /\bDate\b/, why: 'Date: wall-clock time is not deterministic' },
  { re: /\bperformance\b/, why: 'performance.now: real time is not deterministic' },
  { re: /\b(setTimeout|setInterval|requestAnimationFrame|queueMicrotask)\b/, why: 'timers: the simulation advances only by ticks' },
  { re: /\bcrypto\b/, why: 'crypto: not deterministic' },
  { re: /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|hypot|cbrt)\b/, why: 'implementation-approximated maths: use sim/dmath.ts', except: /src\/sim\/dmath\.ts$/ },
  { re: /\*\*(?!\/)/, why: 'the ** operator is implementation-approximated: use sq() or dpow()' },
  { re: /\b(WeakMap|WeakSet|WeakRef|FinalizationRegistry)\b/, why: 'hidden state outside SimState: keep it on the colony/ant/state' },
  { re: /from\s+['"](\.\.\/)+(render|ui|game|audio|dev|modes)\//, why: 'the simulation must not read render, UI or game state' },
  { re: /from\s+['"]three['"]/, why: 'the simulation must not depend on three.js' },
  { re: /\b(window|document|localStorage|sessionStorage|navigator)\b/, why: 'browser state is per client' },
];

function walk(dir: string, out: string[]): void {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
}

/** Blank out comments (keeping line structure) so doc text cannot trip the rules; string contents are kept. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let q: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (q) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === q) q = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      q = c;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && n === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const files: string[] = [];
for (const d of DIRS) walk(join(ROOT, d), files);
for (const f of FILES) files.push(join(ROOT, f));

let problems = 0;
for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const raw = readFileSync(file, 'utf8');
  const rawLines = raw.split('\n');
  const lines = stripComments(raw).split('\n');
  let depth = 0;
  lines.forEach((line, i) => {
    const ok = /\/\/\s*det-ok\b/.test(rawLines[i]);
    for (const r of RULES) {
      if (r.except?.test(rel)) continue;
      if (r.re.test(line) && !ok) {
        console.log(`${rel}:${i + 1}  ${r.why}\n    ${rawLines[i].trim()}`);
        problems++;
      }
    }
    // module-level mutable state
    if (depth === 0 && !ok) {
      if (/^\s*(export\s+)?let\s/.test(line)) {
        console.log(`${rel}:${i + 1}  module-level \`let\` is state outside SimState (mark scratch with // det-ok: <why>)\n    ${rawLines[i].trim()}`);
        problems++;
      } else if (/^\s*(export\s+)?const\s+\w+\s*(:[^=]+)?=\s*new\s+(Map|Set)\b/.test(line)) {
        console.log(`${rel}:${i + 1}  module-level Map/Set is state outside SimState (mark tables with // det-ok: <why>)\n    ${rawLines[i].trim()}`);
        problems++;
      }
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
  });
}

if (problems) {
  console.log(`\ncheck-determinism: ${problems} problem(s) in ${files.length} simulation files`);
  process.exit(1);
}
console.log(`check-determinism: ${files.length} simulation files clean`);
