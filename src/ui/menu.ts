import { SPECIES, SpeciesId, BORROWABLE, CASTES } from '../sim/species';
import type { MapId } from '../maps/types';
import { MAPS, PLAYABLE_MAPS } from '../maps';
import { mapPreview } from './mapPreview';
import { MapStyle } from '../world/terrain';
import { Quality } from '../render/view';
import { MISSIONS, MissionId } from '../sim/missions';
import { profile, settings } from '../game/profile';

/** Which side an AI colony is on: allied with you, one of three teams, or on its own (free-for-all). */
export type AiTeam = 'own' | 'ally' | 2 | 3 | 4;

export interface AiChoice {
  species: SpeciesId;
  /** Gene Thief AIs: the castes it borrowed */
  borrowed: string[];
  team: AiTeam;
}

export type GameMode = 'mission' | 'skirmish' | 'sandbox' | 'arena';

export interface MenuChoice {
  mode: GameMode;
  /** with mode 'mission' */
  mission: MissionId;
  species: SpeciesId;
  borrowed: string[];
  /** AI colonies (up to MAX_AI) */
  ais: AiChoice[];
  style: MapStyle;
  /** an authored map (docs/maps/design.md); when set it replaces the style and size */
  map?: MapId;
  /** storms flood the authored map's low ground (off by default) */
  floods?: boolean;
  /** 'auto' follows the frame rate, starting from high */
  quality: Quality | 'auto';
  /** battle arena: 2–4 teams */
  teams?: number;
}

/** AI colonies beside you: the authored maps have ten colony sites */
export const MAX_AI = 9;

/** Team number in the simulation for a menu choice (you are team 0; free-for-all colonies get their own). */
export function teamOf(t: AiTeam): number | undefined {
  return t === 'own' ? undefined : t === 'ally' ? 0 : 10 + t;
}

/** Two or three borrowed castes for a Gene Thief AI, picked at random. */
export function randomBorrowed(): string[] {
  const pool = [...BORROWABLE];
  const out: string[] = [];
  const n = 2 + Math.floor(Math.random() * 2);
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

const PLAYABLE: SpeciesId[] = ['lasius', 'formica', 'atta', 'solenopsis', 'eciton', 'nasutitermes', 'rhynchotermes', 'hell', 'aurimyrmex', 'termant', 'plagiaria'];

/** Prototype start screen: species, Gene Thief caste picks, AI colonies and their teams, map and quality. */
const thumbs = new Map<MapId, HTMLCanvasElement>();

export function showMenu(parent: HTMLElement, done: (c: MenuChoice) => void): void {
  const choice: MenuChoice = { mode: 'mission', mission: 'meadow', species: 'lasius', borrowed: ['formica_mortar', 'fire_major'], ais: [{ species: 'formica', borrowed: [], team: 'own' }], style: 'meadow', quality: settings().quality, teams: 2 };
  // the arena has its own floor (the formicarium's flat plaster by default)
  let arenaStyle: MapStyle = 'formicarium';
  // the AI line-up each mode keeps while you switch between them
  let skirmishAis = choice.ais;
  let sandboxAis: AiChoice[] = [];
  const root = document.createElement('div');
  root.className = 'menu';
  parent.appendChild(root);
  const render = () => {
    const sp = PLAYABLE.map((id) => {
      const s = SPECIES[id];
      return `<button class="sp-card ${choice.species === id ? 'on' : ''}" data-sp="${id}"><b>${s.common}</b><i>${s.scientific}${s.fictional ? ' · fictional' : ''}</i><p>${s.blurb}</p></button>`;
    }).join('');
    const borrow =
      choice.species === 'plagiaria'
        ? `<h2>Borrowed castes <span class="dim">(any number — each needs its own room tile)</span></h2><div class="opt-row">${BORROWABLE.map((id) => {
            const c = CASTES[id];
            return `<button class="chip ${choice.borrowed.includes(id) ? 'on' : ''}" data-borrow="${id}">${SPECIES[c.species].common.replace(' Ant', '')} ${c.name}</button>`;
          }).join('')}</div>`
        : '';
    const casteName = (id: string) => `${SPECIES[CASTES[id].species].common.replace(' Ant', '')} ${CASTES[id].name}`;
    const teamLabel: Array<[AiTeam, string]> = [['own', 'Own team'], ['ally', 'Your ally'], [2, 'Team 2'], [3, 'Team 3'], [4, 'Team 4']];
    const aiRows = choice.ais
      .map((ai, i) => {
        const spChips = PLAYABLE.map((id) => `<button class="chip ${ai.species === id ? 'on' : ''}" data-ai="${i}" data-aisp="${id}">${SPECIES[id].common.replace(' Ant', '')}</button>`).join('');
        const teamChips = teamLabel.map(([t, n]) => `<button class="chip ${ai.team === t ? 'on' : ''}" data-ai="${i}" data-team="${t}">${n}</button>`).join('');
        const thief =
          ai.species === 'plagiaria'
            ? `<div class="opt-row ai-borrow"><span class="dim">Steals:</span>${BORROWABLE.map((id) => `<button class="chip small ${ai.borrowed.includes(id) ? 'on' : ''}" data-ai="${i}" data-aiborrow="${id}">${casteName(id)}</button>`).join('')}</div>`
            : '';
        return `<div class="ai-row"><div class="ai-head"><b>AI colony ${i + 1}</b><button class="chip" data-ai="${i}" data-airemove="1">Remove</button></div>
          <div class="opt-row">${spChips}</div><div class="opt-row">${teamChips}</div>${thief}</div>`;
      })
      .join('');
    const rivals = `${aiRows || `<p class="dim">${choice.mode === 'sandbox' ? 'No AI colonies: the meadow is yours.' : 'Add at least one AI colony.'}</p>`}<div class="opt-row">${choice.ais.length < MAX_AI ? '<button class="chip" data-aiadd="1">+ Add an AI colony</button>' : ''}<span class="dim">${choice.ais.length} of ${MAX_AI} · you are on Team 1; colonies on your team are allies</span></div>`;
    // the five authored maps (the old random styles stay in the code for missions, tests and old saves)
    if (!choice.map) choice.map = PLAYABLE_MAPS[0];
    const map = `<div class="map-grid">${PLAYABLE_MAPS.map((id) => {
      const m = MAPS[id]!;
      return `<button class="map-card ${choice.map === id ? 'on' : ''}" data-map="${id}"><span class="map-thumb" data-thumb="${id}"></span><b>${m.name}</b><i>${(m.width / 1000).toFixed(1)} × ${(m.depth / 1000).toFixed(1)} m${m.floods.length ? ' · floods' : ''}</i></button>`;
    }).join('')}</div>`;
    const md = choice.map ? MAPS[choice.map] : undefined;
    const mapNote = md
      ? `<p class="dim">${md.blurb} ${(md.width / 1000).toFixed(1)} × ${(md.depth / 1000).toFixed(1)} m, ten colony sites.</p>` +
        (md.floods.length ? `<div class="opt-row"><span class="dim">Floods:</span><button class="chip ${!choice.floods ? 'on' : ''}" data-floods="0">Off</button><button class="chip ${choice.floods ? 'on' : ''}" data-floods="1">On: storms flood the low ground now and then</button></div>` : '')
      : '';
    const q = (['auto', 'low', 'medium', 'high'] as Array<Quality | 'auto'>).map((id) => `<button class="chip ${choice.quality === id ? 'on' : ''}" data-q="${id}">${id[0].toUpperCase() + id.slice(1)}</button>`).join('');
    const modes: Array<[GameMode, string, string]> = [
      ['mission', 'Missions', 'Story missions with a narrator and a boss at the end'],
      ['skirmish', 'Skirmish', 'You against 1 to 9 AI colonies on one of five maps, in teams if you like'],
      ['sandbox', 'Sandbox', 'No rules: spawn creatures and bosses, infinite food'],
      ['arena', 'Battle Arena', 'Pit any ants and creatures against each other, in 2 to 4 teams'],
    ];
    const modeRow = `<div class="mode-tabs">${modes.map(([id, n, d]) => `<button class="mode-tab ${choice.mode === id ? 'on' : ''}" data-mode="${id}"><b>${n}</b><span>${d}</span></button>`).join('')}</div>`;
    const missions = (Object.keys(MISSIONS) as MissionId[])
      .map((id) => {
        const m = MISSIONS[id];
        const best = profile().medals[id];
        const medal = best ? `<span class="medal ${best.medal}" title="Your best: ${best.medal}, ${Math.floor(best.time / 60)} min">${best.medal}</span>` : '';
        return `<button class="sp-card mission-card ${choice.mission === id ? 'on' : ''}" data-mission="${id}"><b>${m.title}${medal}</b><i>${m.style === 'meadow' ? 'Meadow' : 'Forest floor'} · written for the ${SPECIES[m.species].common.toLowerCase()}${m.rival ? ' · one rival colony' : ''}</i><p>${m.brief}</p><p class="dim">${m.stages.length} stages · finale: ${m.stages[m.stages.length - 1].name.replace('Finale: ', '')}</p></button>`;
      })
      .join('');
    const arenaFloors: Array<[MapStyle, string]> = [['formicarium', 'Formicarium'], ['meadow', 'Meadow'], ['forest', 'Forest floor'], ['sandy', 'Sandy scrub']];
    const arenaBody = `<h2>Teams</h2><div class="opt-row">${[2, 3, 4].map((n) => `<button class="chip ${choice.teams === n ? 'on' : ''}" data-teams="${n}">${n} teams</button>`).join('')}<span class="dim">Red, Blue${(choice.teams ?? 2) > 2 ? ', Green' : ''}${(choice.teams ?? 2) > 3 ? ', Gold' : ''} — fill them with any ants and creatures once the arena opens</span></div>
           <h2>Arena floor</h2><div class="opt-row">${arenaFloors.map(([id, n]) => `<button class="chip ${arenaStyle === id ? 'on' : ''}" data-afloor="${id}">${n}</button>`).join('')}</div>`;
    const body =
      choice.mode === 'arena'
        ? arenaBody
        : choice.mode === 'mission'
        ? `<h2>Mission</h2><div class="species-grid">${missions}</div>
           <h2>Colony</h2><div class="species-grid">${sp}</div>${borrow}`
        : `<h2>Colony</h2><div class="species-grid">${sp}</div>${borrow}
           <h2>AI colonies</h2>${rivals}
           <h2>Map</h2>${map}${mapNote}`;
    const go = choice.mode === 'mission' ? `Start ${MISSIONS[choice.mission].title}` : choice.mode === 'sandbox' ? 'Open the sandbox' : choice.mode === 'arena' ? 'Open the arena' : 'Found the colony';
    root.innerHTML = `<div class="menu-card">
      <h1>UNDERGROUND DOMINION</h1>
      <p class="tag">Single-player</p>
      ${modeRow}
      ${body}
      <h2>Graphics</h2><div class="opt-row">${q}</div>
      <button class="go" ${choice.mode === 'skirmish' && !choice.ais.length ? 'disabled title="Add at least one AI colony"' : ''}>${go}</button>
    </div>`;
    // map thumbnails, drawn once from the map data
    root.querySelectorAll<HTMLElement>('[data-thumb]').forEach((el) => {
      const id = el.dataset.thumb as MapId;
      let c = thumbs.get(id);
      if (!c) thumbs.set(id, (c = mapPreview(MAPS[id]!, 124)));
      el.appendChild(c);
    });
  };
  render();
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t) return;
    const d = t.dataset;
    if (d.mode) {
      const next = d.mode as GameMode;
      if (choice.mode === 'skirmish') skirmishAis = choice.ais;
      if (choice.mode === 'sandbox') sandboxAis = choice.ais;
      choice.mode = next;
      if (next === 'skirmish') choice.ais = skirmishAis.length ? skirmishAis : [{ species: 'formica', borrowed: [], team: 'own' }];
      if (next === 'sandbox') choice.ais = sandboxAis;
    } else if (d.mission) {
      choice.mission = d.mission as MissionId;
      choice.species = MISSIONS[choice.mission].species;
    } else if (d.sp) choice.species = d.sp as SpeciesId;
    else if (d.borrow) {
      const i = choice.borrowed.indexOf(d.borrow);
      if (i >= 0) choice.borrowed.splice(i, 1);
      else choice.borrowed.push(d.borrow);
    } else if (d.aiadd) {
      if (choice.ais.length < MAX_AI) {
        const pick = PLAYABLE[(choice.ais.length + 1) % PLAYABLE.length];
        choice.ais.push({ species: pick, borrowed: pick === 'plagiaria' ? randomBorrowed() : [], team: 'own' });
      }
    } else if (d.ai !== undefined) {
      const ai = choice.ais[Number(d.ai)];
      if (!ai) return;
      if (d.airemove) choice.ais.splice(Number(d.ai), 1);
      else if (d.aisp) {
        ai.species = d.aisp as SpeciesId;
        if (ai.species === 'plagiaria' && !ai.borrowed.length) ai.borrowed = randomBorrowed();
      } else if (d.team) ai.team = (/^\d$/.test(d.team) ? Number(d.team) : d.team) as AiTeam;
      else if (d.aiborrow) {
        const k = ai.borrowed.indexOf(d.aiborrow);
        if (k >= 0) ai.borrowed.splice(k, 1);
        else ai.borrowed.push(d.aiborrow);
      }
    } else if (d.teams) choice.teams = Number(d.teams);
    else if (d.afloor) arenaStyle = d.afloor as MapStyle;
    else if (d.style) {
      choice.style = d.style as MapStyle;
      delete choice.map;
    } else if (d.map) choice.map = d.map as MapId;
    else if (d.floods) choice.floods = d.floods === '1';
    else if (d.q) choice.quality = d.q as Quality | 'auto';
    else if (t.classList.contains('go')) {
      if (t.disabled) return;
      root.remove();
      done(choice.mode === 'arena' ? { ...choice, style: arenaStyle } : choice);
      return;
    }
    render();
  });
}
