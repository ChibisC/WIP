import { casteMount } from '../sim/creatures/climb';
import { GameSession, casteTint } from '../game/session';
import { CASTES, SPECIES, SpeciesId } from '../sim/species';
import { CREATURES } from '../sim/creatures/kinds';
import { ARENA } from '../sim/balance';
import { TEAM_NAMES, arenaUnitOk } from '../sim/arena';
import { STANCE, arenaOf } from '../sim/arenaState';
import { TEAM_COLORS } from '../render/game/teamRings';
import { ICONS, antSilhouette } from './icons';
import { button, el, esc, shield } from './dom';

/** Species in the roster, in the menu's order. */
const ROSTER_SPECIES: SpeciesId[] = ['lasius', 'formica', 'atta', 'solenopsis', 'eciton', 'nasutitermes', 'rhynchotermes', 'hell', 'aurimyrmex', 'termant', 'plagiaria'];
const COUNTS = [1, 5, 10, 25, 50];
const SPEEDS: Array<[number, string]> = [
  [0.25, '¼×'],
  [0.5, '½×'],
  [1, '1×'],
  [2, '2×'],
  [4, '4×'],
];
const STANCES: Array<[number, string, string]> = [
  [STANCE.CHARGE, 'Charge', 'Go for the nearest enemy and fight whatever comes near.'],
  [STANCE.HOLD, 'Hold', 'Stay at the team’s corner (creatures at their own post) and fight what comes near.'],
  [STANCE.PASSIVE, 'Passive', 'Stand still and never attack — a dummy for the others to fight or climb.'],
];

/** A small top-down bug glyph for creature buttons (the roster's creature icon). */
const BUG = `<svg viewBox="0 0 32 32" class="ant-sil"><g fill="currentColor"><ellipse cx="16" cy="19" rx="6" ry="8"/><ellipse cx="16" cy="9" rx="4" ry="3.6"/></g><g stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"><path d="M10.5 15l-6-3M10.5 19l-7 0M10.5 23l-6 3M21.5 15l6-3M21.5 19l7 0M21.5 23l6 3M14 6.5l-3-4M18 6.5l3-4"/></g></svg>`;

/**
 * Battle arena (DESIGN 3.13): the team picker with each team's stance, the roster of every ant caste and creature
 * (click to drop the chosen number round the team's corner, or Place to put them where you click), count and
 * level, Clear, pause and speed down to ¼× (for watching climbs). A scoreboard at the top shows each team's units
 * and health, the round's time and the winner. Every change is a command.
 */
export class ArenaPanel {
  readonly root = el('div', 'pnl arena-panel');
  readonly board = el('div', 'arena-board');
  private teamsEl = el('div', 'ar-teams');
  private stanceEl = el('div', 'ar-row ar-stance');
  private tabsEl = el('div', 'ar-tabs');
  private speciesEl = el('div', 'ar-species');
  private rosterEl = el('div', 'ar-roster');
  private optsEl = el('div', 'ar-row ar-opts');
  private ctrlEl = el('div', 'ar-row ar-ctrl');
  private tab: 'ants' | 'creatures' = 'ants';
  private species: SpeciesId = 'lasius';
  private placeBtn: HTMLButtonElement;
  private pauseBtn: HTMLButtonElement;
  private viewEl = el('div', 'ar-row ar-view');
  private railsBtn: HTMLButtonElement;
  private hitBtn: HTMLButtonElement;
  private combatBtn: HTMLButtonElement;
  private key = '';

  constructor(private s: GameSession) {
    shield(this.root);
    this.placeBtn = button('ar-place', 'Place', '<b>Place</b>Click the ground to drop the chosen unit there, for the chosen team. Click again or Esc to stop.', () => s.setTool(s.tool === 'arena' ? 'none' : 'arena'));
    this.pauseBtn = button('ar-pause', '❚❚', '<b>Pause</b><span class="k">P</span>', () => s.togglePause());
    // views for testing climbing and contact: the creatures' climb rails and riding slots, and the hitboxes
    this.railsBtn = button('chip small', 'Climb rails', '<b>Climb rails</b>Show the routes ants take up each creature\'s legs and the places they ride on its back.', () => s.setClimbDebug(!s.climbDebug));
    this.hitBtn = button('chip small', 'Hitboxes', '<b>Hitboxes</b>Show every body\'s hit shapes (what bites and climbs test against).', () => s.setHitboxes(!s.hitboxes));
    this.combatBtn = button('chip small', 'Combat', '<b>Combat</b>Show what the fighters are doing: a pin on anchored ones (holding, firing, recovering), blocked (red), backing off (orange), going round (cyan arrows), their reserved slots (green) and the free and taken slots round each target.', () => s.setCombatDebug(!s.combatDebug));
    this.viewEl.append(el('span', 'ar-lbl', 'Show'), this.railsBtn, this.hitBtn, this.combatBtn);
    this.root.append(el('div', 'ar-title sc', 'Battle Arena'), this.teamsEl, this.stanceEl, this.tabsEl, this.speciesEl, this.rosterEl, this.optsEl, this.ctrlEl, this.viewEl);
    this.build();
  }

  /** Rebuild after a selection made elsewhere (keys). */
  refresh(): void {
    this.build();
  }

  /** Rebuild the static parts (teams, tabs, roster, options) when the selection changes. */
  private build(): void {
    const s = this.s;
    const A = arenaOf(s.world);
    if (!A) return;
    // teams
    this.teamsEl.innerHTML = '';
    A.teams.forEach((_, i) => {
      const b = button('ar-team' + (s.arenaTeam === i ? ' on' : ''), `<i style="background:${TEAM_COLORS[i]}"></i><span>${TEAM_NAMES[i]}</span><b class="n">0</b>`, `<b>Team ${TEAM_NAMES[i]}</b>New units join this team. <span class="k">Shift</span>+${i + 1} also picks it.`, () => {
        s.arenaTeam = i;
        this.build();
      });
      b.style.setProperty('--team', TEAM_COLORS[i]);
      this.teamsEl.appendChild(b);
    });
    // the chosen team's stance, and clearing it
    this.stanceEl.innerHTML = '';
    for (const [st, name, tip] of STANCES) {
      const b = button('chip ar-st', name, `<b>${name}</b>${tip}`, () => s.issue({ type: 'arenaStance', team: s.arenaTeam, stance: st }));
      b.dataset.st = String(st);
      this.stanceEl.appendChild(b);
    }
    this.stanceEl.appendChild(button('chip ar-clear', 'Clear team', `<b>Clear team ${TEAM_NAMES[s.arenaTeam]}</b>Take all its units off the field.`, () => s.issue({ type: 'arenaClear', team: s.arenaTeam })));
    // roster tabs
    this.tabsEl.innerHTML = '';
    for (const [id, name] of [
      ['ants', 'Ants & termites'],
      ['creatures', 'Creatures'],
    ] as const) {
      const b = button('ar-tab' + (this.tab === id ? ' on' : ''), name, id === 'ants' ? 'Every caste of every species (no queens or kings).' : 'Every creature and boss (bosses marked).', () => {
        this.tab = id;
        this.build();
      });
      this.tabsEl.appendChild(b);
    }
    // species filter (ants)
    this.speciesEl.innerHTML = '';
    this.speciesEl.style.display = this.tab === 'ants' ? '' : 'none';
    if (this.tab === 'ants')
      for (const sp of ROSTER_SPECIES) {
        const b = button('chip small' + (this.species === sp ? ' on' : ''), esc(SPECIES[sp].common.replace(' Ant', '').replace('Termites', 'Term.')), `<b>${esc(SPECIES[sp].common)}</b><i>${esc(SPECIES[sp].scientific)}</i>`, () => {
          this.species = sp;
          this.build();
        });
        this.speciesEl.appendChild(b);
      }
    // roster
    this.rosterEl.innerHTML = '';
    const col = TEAM_COLORS[s.arenaTeam];
    const entry = (unit: string, icon: string, name: string, sub: string, tip: string) => {
      const b = button('ar-unit' + (s.arenaUnit === unit ? ' on' : ''), `${icon}<span class="nm">${esc(name)}</span><span class="sb">${esc(sub)}</span>`, tip, (e) => {
        s.arenaUnit = unit;
        // with Place on, a click only chooses the unit; otherwise it drops them round the team's corner
        if (s.tool !== 'arena' && !e.shiftKey) s.arenaSpawnAtTeam(unit);
        this.build();
      });
      this.rosterEl.appendChild(b);
    };
    if (this.tab === 'ants') {
      for (const cd of Object.values(CASTES)) {
        if (cd.species !== this.species || !arenaUnitOk('ant:' + cd.id)) continue;
        const tint = '#' + casteTint(cd.id).multiplyScalar(1.35).getHexString();
        entry('ant:' + cd.id, antSilhouette(cd.role, tint), cd.name, `${cd.length} mm · ${cd.hp} hp`, `<b>${esc(SPECIES[cd.species].common)} — ${esc(cd.name)}</b>${cd.length} mm · health ${cd.hp} · bite ${cd.bite}${cd.acid ? ' · formic acid' : ''}${cd.sting ? ' · venom sting' : ''}<br>${casteMount(cd.id) === 'small' ? 'Mounts large and huge creatures' : casteMount(cd.id) === 'large' ? 'Mounts huge creatures only' : 'Cannot mount creatures'}<br>${esc(cd.fact)}<br><i>Click: ${s.arenaCount} for Team ${TEAM_NAMES[s.arenaTeam]}. Shift+click: choose for Place.</i>`);
      }
    } else {
      for (const k of Object.values(CREATURES)) {
        if (!arenaUnitOk('cr:' + k.id)) continue;
        entry('cr:' + k.id, `<span style="color:${k.boss ? '#e0a050' : '#c8b490'}">${BUG}</span>`, k.name.replace(/^Common /, ''), `${k.boss ? 'boss · ' : ''}${k.length} mm · ${k.hp} hp`, `<b>${esc(k.name)}</b><i>${esc(k.sci)}</i><br>${esc(k.role)}<br>${k.length} mm · health ${k.hp} · armour ${k.armor} · bite ${k.bite}${k.venom ? ' · venom' : ''}<br><i>Click: ${s.arenaCount} for Team ${TEAM_NAMES[s.arenaTeam]}. Shift+click: choose for Place.</i>`);
      }
    }
    // count, level, place
    this.optsEl.innerHTML = '';
    this.optsEl.appendChild(el('span', 'ar-lbl', 'Count'));
    for (const n of COUNTS)
      this.optsEl.appendChild(
        button('chip small' + (s.arenaCount === n ? ' on' : ''), String(n), `Spawn ${n} at a time (at most ${ARENA.maxUnits} units on the field).`, () => {
          s.arenaCount = n;
          this.build();
        }),
      );
    this.optsEl.appendChild(el('span', 'ar-lbl', 'Level'));
    ['I', 'II', 'III'].forEach((r, i) =>
      this.optsEl.appendChild(
        button('chip small' + (s.arenaLevel === i + 1 ? ' on' : ''), r, `<b>Level ${r}</b>Health ×${[1, 1.25, 1.5][i]} and stronger bites, as an ant raised on a level ${r} tile.`, () => {
          s.arenaLevel = i + 1;
          this.build();
        }),
      ),
    );
    this.optsEl.appendChild(this.placeBtn);
    // round controls
    this.ctrlEl.innerHTML = '';
    this.ctrlEl.appendChild(button('chip ar-clearall', 'Clear all', '<b>Clear all</b>Take every unit off the field and start a new round.', () => s.issue({ type: 'arenaClear', team: -1 })));
    this.ctrlEl.appendChild(this.pauseBtn);
    for (const [v, lbl] of SPEEDS) {
      const b = button('chip small ar-speed', lbl, `Game speed ${lbl}${v < 1 ? ' — slow motion, for watching climbs and grapples' : ''}. <span class="k">−</span>/<span class="k">=</span>`, () => {
        s.setSpeed(v);
        s.loop.paused = false;
      });
      b.dataset.v = String(v);
      this.ctrlEl.appendChild(b);
    }
    void col;
    this.key = '';
  }

  update(): void {
    const s = this.s;
    const A = arenaOf(s.world);
    this.root.style.display = A ? '' : 'none';
    this.board.style.display = A ? '' : 'none';
    if (!A) return;
    // team counts and the chosen team's stance
    A.teams.forEach((T, i) => {
      const b = this.teamsEl.children[i] as HTMLElement | undefined;
      const n = b?.querySelector('.n');
      if (n && n.textContent !== String(T.alive)) n.textContent = String(T.alive);
    });
    const T = A.teams[s.arenaTeam];
    for (const b of Array.from(this.stanceEl.querySelectorAll<HTMLElement>('.ar-st'))) b.classList.toggle('on', !!T && Number(b.dataset.st) === T.stance);
    this.placeBtn.classList.toggle('on', s.tool === 'arena');
    this.railsBtn.classList.toggle('on', s.climbDebug);
    this.hitBtn.classList.toggle('on', s.hitboxes);
    this.combatBtn.classList.toggle('on', s.combatDebug);
    this.pauseBtn.classList.toggle('on', s.loop.paused);
    this.pauseBtn.textContent = s.loop.paused ? '▶' : '❚❚';
    for (const b of Array.from(this.ctrlEl.querySelectorAll<HTMLElement>('.ar-speed'))) b.classList.toggle('on', Number(b.dataset.v) === s.loop.speed && !s.loop.paused);
    // scoreboard: units and health per team, the round's time, the winner
    const maxHp = Math.max(1, ...A.teams.map((t) => t.hp));
    const m = Math.floor(A.t / 60);
    const sec = String(Math.floor(A.t % 60)).padStart(2, '0');
    const rows = A.teams
      .map((t, i) => `<div class="ab-team${A.winner === i ? ' win' : ''}${t.alive === 0 && A.fought ? ' out' : ''}"><i style="background:${TEAM_COLORS[i]}"></i><span class="sc">${TEAM_NAMES[i]}</span><b>${t.alive}</b><div class="ab-bar"><em style="width:${((t.hp / maxHp) * 100).toFixed(1)}%;background:${TEAM_COLORS[i]}"></em></div><small>${t.lost ? `${t.lost} lost` : ''}</small></div>`)
      .join('');
    const banner =
      A.winner >= 0 ? `<div class="ab-win sc" style="color:${TEAM_COLORS[A.winner]}">${TEAM_NAMES[A.winner]} wins</div>` : A.winner === -2 ? '<div class="ab-win sc">Nobody left standing</div>' : A.fought ? `<div class="ab-time">${m}:${sec}</div>` : '<div class="ab-time dim">Add units to two teams to start a round</div>';
    const html = `<div class="ab-teams">${rows}</div>${banner}`;
    if (html !== this.key) {
      this.key = html;
      this.board.innerHTML = html;
    }
  }
}
