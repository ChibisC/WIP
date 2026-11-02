/**
 * Team layouts on the five maps (CHANGE_PLAN §22; world/teamSites.ts): for every common team shape, the sites each
 * team gets (the map's authored set, else the search's), the land routes to the nearest ally and enemy, and the
 * fairness numbers. Writes docs/maps/team-sites.md and, for the sketches, docs/maps/team-sites/sites.json
 * (python3 tools/team-sites-sketch.py draws them on docs/maps/sketches).
 *
 *   npx vite-node tools/team-sites.ts [-- search]   (search: ignore the authored sets, print what the search picks)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { MAPS, PLAYABLE_MAPS } from '../src/maps';
import { BALANCE } from '../src/sim/balance';
import { surfaceLayout } from '../src/world/surfaceLayout';
import { pickTeamSites, siteRoutes, shapeKey, teamGroups } from '../src/world/teamSites';

const args = process.argv.slice(2).filter((a) => a !== '--');
const searchOnly = args.includes('search');

/** Team shapes, as a team per colony (the first colony is the player's in a skirmish). */
export const SHAPES: Array<{ name: string; teams: Array<number | undefined> }> = [
  { name: '2v2', teams: [0, 0, 1, 1] },
  { name: '2v1 (you + an AI ally v one AI)', teams: [0, 0, 1] },
  { name: '3v1', teams: [0, 0, 0, 1] },
  { name: '2v2v2', teams: [0, 0, 1, 1, 2, 2] },
  { name: '2v1v1 (you + an AI ally v two AIs on their own)', teams: [0, 0, undefined, undefined] },
  { name: '2v1v1v1', teams: [0, 0, undefined, undefined, undefined] },
  { name: '3v3', teams: [0, 0, 0, 1, 1, 1] },
];

const S = BALANCE.aiAllies.sites;
const md: string[] = [];
md.push('# Team sites (CHANGE_PLAN §22)');
md.push('');
md.push(`Made by \`npx vite-node tools/team-sites.ts\` from the maps and \`world/teamSites.ts\`. Routes are land routes on the map's hex layout between site entrances (water and walls go round). Limits: an ally within **${S.allyMaxRoute * 100} %** of the map's width, every enemy at least **${S.enemyMinRoute * 100} %** away, no enemy site between two allies. Fairness: each team's mean route to the nearest food zone, to the map's middle and to its nearest enemy (the spread between teams is what the search keeps small); in an uneven match the smaller side gets the nearer food. "authored" = the map file's \`teamSets\`, "search" = picked by the search. Sketches with the teams in colour: \`docs/maps/team-sites/\`.`);
md.push('');
const sketch: Record<string, unknown> = {};
for (const id of PLAYABLE_MAPS) {
  const def = MAPS[id]!;
  const saved = def.teamSets;
  if (searchOnly) def.teamSets = undefined;
  const L = surfaceLayout(def);
  const R = siteRoutes(L);
  md.push(`## ${def.name} (${def.width} × ${def.depth} mm; ally ≤ ${Math.round(S.allyMaxRoute * def.width)} mm, enemy ≥ ${Math.round(S.enemyMinRoute * def.width)} mm)`);
  md.push('');
  md.push('| shape | sites by team | ally route (mm) | nearest enemy (mm) | food by team (mm) | middle by team (mm) | limits | source |');
  md.push('|---|---|---|---|---|---|---|---|');
  const shapes: Record<string, number[][]> = {};
  for (const sh of SHAPES) {
    const p = pickTeamSites(L, sh.teams);
    if (!p) continue;
    const groups = teamGroups(sh.teams);
    const bySide = groups.map((g) => g.map((i) => p.sites[i]));
    shapes[shapeKey(groups)] = bySide;
    const r = (x: number) => (Number.isFinite(x) ? String(Math.round(x)) : '—');
    md.push(`| ${sh.name} | ${bySide.map((s) => s.join(' + ')).join(' v ')} | ${groups.map((g) => g.map((i) => r(p.ally[i])).join('/')).join(' · ')} | ${groups.map((g) => g.map((i) => r(p.enemy[i])).join('/')).join(' · ')} | ${p.groupFood.map(r).join(' · ')} | ${p.groupMid.map(r).join(' · ')} | ${p.violations.length ? p.violations.join('; ') : 'ok'} | ${p.source} |`);
    console.log(`${id} ${shapeKey(groups).padEnd(8)} ${bySide.map((s) => s.join('+')).join(' v ').padEnd(22)} ${p.source} ${p.violations.length ? 'VIOLATES ' + p.violations.join('; ') : 'ok'}`);
  }
  md.push('');
  const centres = L.sites.map((s) => [L.hex.centerX(s.centre), L.hex.centerY(s.centre)]);
  sketch[id] = { width: def.width, depth: def.depth, centres, shapes, routes: Array.from(R.d).map((x) => (Number.isFinite(x) ? Math.round(x) : -1)) };
  def.teamSets = saved;
}
if (!searchOnly) {
  mkdirSync('docs/maps/team-sites', { recursive: true });
  writeFileSync('docs/maps/team-sites.md', md.join('\n') + '\n');
  writeFileSync('docs/maps/team-sites/sites.json', JSON.stringify(sketch));
  console.log('wrote docs/maps/team-sites.md and docs/maps/team-sites/sites.json');
}
