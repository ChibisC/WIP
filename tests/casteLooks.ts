/**
 * The user's note of 2026-11-02 (10:40): every caste's tile — ants, termites and castes added later — its own colour
 * and texture, the same look on the build buttons, the pheromone-marker group cards and the minimap.
 *
 *   npx vite-node tests/casteLooks.ts
 */
import { CASTES, SPECIES } from '../src/sim/species';
import { CASTE_PALETTE, CASTE_PATTERNS, casteLook, casteSwatchUrl, hasBroodLook, resetCasteLooks } from '../src/render/casteLook';
import { casteTint } from '../src/game/nestView';
import { casteIcon } from '../src/ui/icons';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// CIE76 colour difference between two sRGB hex colours
function lab(hex: number): [number, number, number] {
  const lin = (v: number) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = lin((hex >> 16) & 255);
  const g = lin((hex >> 8) & 255);
  const b = lin(hex & 255);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const Y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const Z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const dE = (a: number, b: number) => {
  const p = lab(a);
  const q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

const brood = Object.keys(CASTES).filter(hasBroodLook);
check('every caste raised on brood tiles has a look', brood.every((c) => casteLook(c).patternId >= 0 && casteLook(c).patternId < 16), `${brood.length} castes`);

// the palette itself: every pair of colours clearly apart
let minPal = 1e9;
let minPair = '';
const pal = Object.entries(CASTE_PALETTE);
for (let i = 0; i < pal.length; i++)
  for (let j = i + 1; j < pal.length; j++) {
    const d = dE(pal[i][1], pal[j][1]);
    if (d < minPal) [minPal, minPair] = [d, `${pal[i][0]}/${pal[j][0]}`];
  }
check('palette colours all clearly different (ΔE ≥ 20)', minPal >= 20, `closest ${minPair} ΔE ${minPal.toFixed(1)}`);

// earth tones (user note 12:04): muted colours — Lab chroma at most 60 each and 40 on average (the bright palette
// it replaced averaged 57)
const chroma = pal.map(([k, v]) => { const [, a, b] = lab(v); return [k, Math.hypot(a, b)] as [string, number]; });
const meanC = chroma.reduce((t, [, c]) => t + c, 0) / chroma.length;
check('palette is earth tones (muted: chroma ≤ 60 each, mean ≤ 40)', chroma.every(([, c]) => c <= 60) && meanC <= 40, `mean ${meanC.toFixed(0)}; ${chroma.map(([k, c]) => `${k} ${c.toFixed(0)}`).join(', ')}`);
check('palette has the asked-for tones', ['grey', 'black', 'brown', 'sand', 'grass', 'straw', 'sky', 'red', 'purple', 'orange'].every((k) => k in CASTE_PALETTE));

// within each species: no shared colour, no shared texture
for (const sp of Object.keys(SPECIES)) {
  const cs = brood.filter((c) => CASTES[c].species === sp);
  const cols = new Set(cs.map((c) => casteLook(c).colour));
  const pats = new Set(cs.map((c) => casteLook(c).pattern));
  check(`${sp}: ${cs.length} castes, each its own colour and texture`, cols.size === cs.length && pats.size === cs.length, cs.map((c) => `${c} ${casteLook(c).colour}/${casteLook(c).pattern}`).join(', '));
}

// anywhere: no two castes share both (stolen castes in a Mimic Ant or Termant nest still differ)
const pairs = new Map<string, string>();
const dup: string[] = [];
for (const c of brood) {
  const k = `${casteLook(c).colour}|${casteLook(c).pattern}`;
  if (pairs.has(k)) dup.push(`${pairs.get(k)} = ${c}`);
  pairs.set(k, c);
}
check('no two castes anywhere share colour and texture', dup.length === 0, dup.join('; '));
const patUse = CASTE_PATTERNS.map((p) => brood.filter((c) => casteLook(c).pattern === p).length);
check('every texture is used', patUse.every((n) => n > 0), patUse.join(' '));

// the tile, the UI and the minimap use the same colour
const c0 = 'formica_mortar';
check('tile tint is the caste colour', '#' + casteTint(c0).getHexString() === casteLook(c0).css, `${casteTint(c0).getHexString()} vs ${casteLook(c0).css}`);
check('UI badge carries the swatch of its tile', casteIcon(c0).includes(casteSwatchUrl(c0)) && casteIcon(c0).includes('ant-sil'));
check('badge style attribute is well formed (swatch url single-quoted)', /style="background-image:url\('[^'"]*'\)"/.test(casteIcon(c0)));
check('different castes, different badges', casteSwatchUrl('formica_mortar') !== casteSwatchUrl('formica_rapid'));

// a caste added later (a new species' castes) gets a free look, unlike its own species
const fake = ['zz_worker', 'zz_soldier', 'zz_major'];
for (const [i, id] of fake.entries()) (CASTES as Record<string, unknown>)[id] = { ...CASTES.lasius_worker, id, species: 'zzz', role: ['worker', 'soldier', 'major'][i], nanitic: false };
resetCasteLooks();
const fl = fake.map((c) => casteLook(c));
check('future castes get looks of their own', new Set(fl.map((l) => l.colour)).size === 3 && new Set(fl.map((l) => l.pattern)).size === 3, fl.map((l) => `${l.colour}/${l.pattern}`).join(', '));
const all = Object.keys(CASTES).filter(hasBroodLook);
check('…without repeating any existing pair', new Set(all.map((c) => `${casteLook(c).colour}|${casteLook(c).pattern}`)).size === all.length);
check('…and the existing castes keep their looks', casteLook('lasius_worker').colour === 'sand' && casteLook('atta_minim').pattern === 'pellets');
for (const id of fake) delete (CASTES as Record<string, unknown>)[id];
resetCasteLooks();

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
