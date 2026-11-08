/**
 * Saiy-Ant Blaster balance (CHANGE_PLAN §31; docs/balance/castes.md "Saiy-Ant Blaster"):
 *  1. shooters at equal food against melee references, starting apart (they get to shoot) and in contact (melee has
 *     reached them): the blaster against the wood ants' mortar and rapid sprayer;
 *  2. the gold form 4 s → 10 s: the Saiy worker and soldier against references, both ways;
 *  3. one beam: a line of small enemies, and big ones.
 *   npx vite-node tools/blaster-balance.ts -- [shooters|gold|beam|all] [food=150]
 */
process.env.BALANCE_MATRIX_LIB = '1';
const { fight } = await import('./balance-matrix');
const { BALANCE } = await import('../src/sim/balance');
const { CASTES, casteOf } = await import('../src/sim/species');
const { casteCosts } = await import('../src/sim/tiles');
const { EventBus } = await import('../src/core/events');
const { createWorld } = await import('../src/sim/mapGen');
const { makeAnt } = await import('../src/sim/factory');
const { AS, SURFACE } = await import('../src/sim/types');

const args = (globalThis as unknown as { process: { argv: string[] } }).process.argv.slice(2).filter((a) => a !== '--');
const what = args[0] ?? 'all';
const FOOD = Number(args[1] ?? 150);
const cost = (c: string) => casteCosts(c).build + casteCosts(c).hatch;
const nFor = (c: string) => Math.max(1, Math.round(FOOD / cost(c)));

/** Mean margin (−1..1, > 0: `a` wins) over three seeds, both ways round. */
function margin(a: string, b: string, gap = 50): { d: number; t: number } {
  let d = 0;
  let t = 0;
  for (const seed of [3, 4, 5]) {
    const r = fight(a, nFor(a), b, nFor(b), seed, 120, undefined, gap);
    const q = fight(b, nFor(b), a, nFor(a), seed, 120, undefined, gap);
    d += (r.a - r.b + (q.b - q.a)) / 6;
    t += (r.t + q.t) / 6;
  }
  return { d, t };
}

const REFS = ['lasius_worker', 'lasius_soldier', 'atta_media', 'formica_soldier', 'fire_soldier', 'aurimyrmex_soldier', 'fire_major'];
if (what === 'shooters' || what === 'all') {
  console.log(`\n== shooters at equal food (${FOOD}), apart / in contact: mean margin (> 0 the shooter wins)`);
  for (const s of ['formica_mortar', 'formica_rapid', 'aurimyrmex_blaster']) {
    const row = [`${s.padEnd(20)} n=${nFor(s)}`];
    for (const r of REFS) {
      const far = margin(s, r);
      const near = margin(s, r, 4);
      row.push(`${r.replace(/_.*/, '').slice(0, 5)}.${r.split('_')[1].slice(0, 4)} ${far.d >= 0 ? '+' : ''}${far.d.toFixed(2)}/${near.d >= 0 ? '+' : ''}${near.d.toFixed(2)}`);
    }
    console.log(row.join('  '));
  }
}

if (what === 'gold' || what === 'all') {
  console.log(`\n== the gold form: Saiy-Ants against references (equal food ${FOOD}), gold 4 s / 10 s`);
  const S = BALANCE.surge;
  const keep = { ...S };
  for (const [dur, cd] of [[4, 20], [10, 30]] as Array<[number, number]>) {
    S.duration = dur;
    S.cooldown = cd;
    const row = [`gold ${dur} s, cooldown ${cd} s:`];
    for (const a of ['aurimyrmex_worker', 'aurimyrmex_soldier']) {
      const refs = a.endsWith('worker') ? ['lasius_worker', 'formica_worker', 'fire_minor', 'hell_worker'] : ['lasius_soldier', 'formica_soldier', 'fire_soldier', 'hell_soldier'];
      let sum = 0;
      for (const r of refs) sum += margin(a, r).d;
      row.push(`${a} ${(sum / refs.length >= 0 ? '+' : '') + (sum / refs.length).toFixed(2)}`);
    }
    console.log(row.join('   '));
  }
  Object.assign(S, keep);
}

if (what === 'beam' || what === 'all') {
  console.log('\n== one beam (gold): what it does to a line of enemies');
  const B = BALANCE.blaster;
  for (const [foe, n] of [['lasius_worker', 6], ['atta_media', 6], ['formica_soldier', 3], ['fire_major', 2], ['aurimyrmex_soldier', 3]] as Array<[string, number]>) {
    const ev = new EventBus();
    const w = createWorld({ seed: 3, style: 'formicarium', width: 600, depth: 600, colonies: [{ species: 'aurimyrmex', player: true, ai: false }, { species: CASTES[foe].species, player: false, ai: false }], food: 0, aphids: 0, plants: 0, puddles: 0, settings: { creatures: 0 } } as never, ev);
    w.terrain.clearArea(150, 150, 450, 450);
    const b = makeAnt(w, 0, 'aurimyrmex_blaster', SURFACE, 250, 300, 0);
    const L = casteOf('aurimyrmex_blaster').length * B.beamReach;
    const foes = Array.from({ length: n }, (_, k) => makeAnt(w, 1, foe, SURFACE, 262 + (k * (L - 16)) / Math.max(1, n - 1), 300, Math.PI));
    w.reindex();
    b.tgt = foes[0].id;
    b.tk = 3;
    b.state = AS.Attack;
    b.surgeT = 60;
    b.shotN = B.beamEvery - 1;
    let tKill = -1;
    for (let i = 0; i < 20 * 5; i++) {
      for (const f of foes) if (f.state !== AS.Dead) f.stun = 99;
      w.step(0.05);
      ev.drain();
      if (tKill < 0 && foes.every((f) => f.state === AS.Dead)) tKill = i / 20;
    }
    const left = foes.map((f) => (f.state === AS.Dead ? 0 : f.hp / f.maxHp));
    console.log(`${foe.padEnd(20)} ×${n}: ${tKill >= 0 ? `all dead in ${tKill.toFixed(2)} s` : `health left ${left.map((x) => Math.round(x * 100) + ' %').join(', ')}`}`);
  }
}
