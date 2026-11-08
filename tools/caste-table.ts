/**
 * Every caste's fighting numbers in one table (balance pass, user 2026-11-02): health, bite, attack interval,
 * armour, speed, extra damage (acid, venom, glue, snap, a Blaster's orbs) as damage per second, cost (build + hatch), and two summary
 * numbers: power = effective health × damage per second (the war AI's weight), and power per food.
 *   npx vite-node tools/caste-table.ts [-- creatures]
 */
import { CASTES, SPECIES } from '../src/sim/species';
import { casteCosts } from '../src/sim/tiles';
import { CREATURES } from '../src/sim/creatures/kinds';
import { BALANCE, NASUTE } from '../src/sim/balance';

const args = process.argv.slice(2).filter((a) => a !== '--');
const pad = (s: string | number, n: number) => String(s).padStart(n);
if (args[0] !== 'creatures') {
  console.log('caste                     role     len  hp    bite  int   armor spd   +dps  dps   cost  power  /food');
  for (const sp of Object.values(SPECIES)) {
    for (const id of sp.castes) {
      const c = CASTES[id];
      if (!c || c.role === 'queen' || c.role === 'king') continue;
      const acid = c.acid ? (c.acid.kind === 'ramp' ? (NASUTE.ramp.startDps + NASUTE.ramp.capDps) / 2 : c.acid.damage / Math.max(0.2, c.acid.cooldown)) : 0;
      const venom = c.sting ? (c.sting.dps * Math.min(c.sting.maxStacks, 2)) / (c.sting.every ?? 1) * 0.35 : 0;
      const glue = c.glue ? c.glue.damage / c.glue.cooldown : 0;
      const snap = c.snap ? (c.snap.dps * c.snap.hold + (c.snap.burst ?? 0)) / (c.snap.cooldown + c.snap.hold) : 0;
      // (the Saiy-Ant Blaster: its orbs, outside the gold form; the beam is extra)
      const blast = c.blast ? BALANCE.blaster.orbDamage / BALANCE.blaster.interval : 0;
      const extra = acid + venom + glue + snap + blast;
      const dps = c.bite / Math.max(0.3, c.attackInterval) + extra;
      const ehp = c.hp * (1 + c.armor * 0.05);
      const cost = casteCosts(id).build + casteCosts(id).hatch;
      const power = ehp * dps;
      console.log(`${id.padEnd(25)} ${c.role.padEnd(8)} ${pad(c.length, 4)} ${pad(c.hp, 5)} ${pad(c.bite, 5)} ${pad(c.attackInterval, 5)} ${pad(c.armor, 5)} ${pad(c.speed, 4)} ${pad(extra.toFixed(1), 5)} ${pad(dps.toFixed(1), 5)} ${pad(cost, 5)} ${pad(power.toFixed(0), 6)} ${pad((power / cost).toFixed(1), 6)}`);
    }
  }
} else {
  console.log('creature        rel       len  hp     armor spd  dmg / interval  boss');
  for (const k of Object.values(CREATURES)) {
    const kk = k as unknown as Record<string, unknown>;
    console.log(`${k.id.padEnd(15)} ${String(k.relation).padEnd(9)} ${pad(k.length, 4)} ${pad(k.hp, 6)} ${pad(k.armor, 5)} ${pad(k.speed, 4)} ${pad(String(kk.damage ?? kk.bite ?? '?'), 5)} / ${String(kk.attackInterval ?? kk.interval ?? '?')}  ${k.boss ? 'boss' : ''}`);
  }
}
