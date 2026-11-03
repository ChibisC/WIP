import { creatureKind } from '../sim/creatures/kinds';
import './theme.css';
import { GameSession } from '../game/session';
import { SimEvent } from '../core/events';
import { markerCounts } from '../sim/markers';
import { Tips, Toasts, el, esc } from './dom';
import { TopBar } from './topBar';
import { Minimaps } from './minimaps';
import { MarkerPanel } from './markerPanel';
import { BuildPanel } from './buildPanel';
import { InfoCard } from './infoCard';
import { Menus } from './menus';
import { BossBar } from './bossBar';
import { CreatureBars } from './creatureBars';
import { SandboxPanel } from './sandboxPanel';
import { missionOf } from '../sim/missions';
import { getSave } from '../game/saves';
import { recordMedal, settings } from '../game/profile';
import { GameAudio } from '../audio/gameAudio';
import { CREATURES } from '../sim/creatures/kinds';
import { ArenaPanel } from './arenaPanel';
import { arenaOf } from '../sim/arenaState';
import { TOUCH } from '../core/device';
import { missionDef } from '../sim/missions';
import { storyOf } from '../sim/story/state';
import { storyMedals, storyStolen } from '../sim/story/runner';
import { recordLoss, recordWin, campaign } from '../game/campaign';
import { CHAPTERS } from '../story/campaign';
import { storyText } from '../story/text';
import { showStoryEnd } from './storyEnd';
import { firstMedal, lossesNeed } from '../story/medalText';
import { dayNightAt, dayNightLabel } from '../sim/story/dayNight';
import './story.css';

/** what the touch cancel button names */
const TOOL_NAMES: Record<string, string> = { dig: 'digging', tile: 'building', upgrade: 'upgrading', remove: 'deleting', marker: 'marker', spawn: 'placing', arena: 'placing' };

/**
 * The in-game interface, laid out like the reference: top bar (Missions,
 * toggles, resources, Menu), two minimaps with the area tabs above them
 * bottom-left, the marker panel bottom-centre and the build panel
 * bottom-right, plus marker count labels, tooltips, messages and dialogs.
 */
export class GameUI {
  root = el('div', 'gui');
  private tips: Tips;
  private toasts = new Toasts();
  private top: TopBar;
  private minimaps: Minimaps;
  private markers: MarkerPanel;
  private build: BuildPanel;
  private info: InfoCard;
  private menus: Menus;
  private boss: BossBar;
  private crBars: CreatureBars;
  private sandbox: SandboxPanel;
  /** battle arena: roster, teams and the scoreboard (only in arena games) */
  private arena: ArenaPanel | null = null;
  /** effects, ambience and music */
  readonly audio: GameAudio;
  /** narrator captions (missions) */
  private caption = el('div', 'caption');
  /** story levels: letterbox bars and Skip while an in-engine shot plays */
  private letterbox = el('div', 'letterbox', '<i class="t"></i><i class="b"></i><button class="skip">Skip ▸</button>');
  /** mission goals, always in view under the top-left buttons */
  private goals = el('div', 'pnl goals-mini');
  private goalsKey = '';
  private captionT = 0;
  /** the end-of-game screen has been shown */
  private ended = false;
  private labels: HTMLElement[] = [];
  private cursorTip = el('div', 'cursor-tip');
  private paused = el('div', 'paused-badge sc', 'Paused');
  private obsBar = el('div', 'pnl obs-bar');
  private status = el('div', 'status-line');
  private vignette = el('div', 'queen-vignette');
  private tileLayer = el('div', 'tile-labels');
  private tileEls: HTMLElement[] = [];
  private starvingT = 0;
  private tick = 0;
  private userScale = settings().uiScale;
  /** touch: the compact layout is on (small screens; see applyScale) */
  private compact = false;
  /** touch: cancels the active tool, or stops following an ant (there is no Esc key) */
  private cancelChip = el('button', 'bbtn touch-cancel');

  constructor(private s: GameSession, parent: HTMLElement) {
    parent.appendChild(this.root);
    this.menus = new Menus(s);
    this.top = new TopBar(s, () => this.menus.missions(), () => this.menus.pause(), () => this.menus.help());
    this.minimaps = new Minimaps(s);
    this.markers = new MarkerPanel(s);
    this.build = new BuildPanel(s);
    this.info = new InfoCard(s);
    this.boss = new BossBar(s);
    this.crBars = new CreatureBars(s);
    this.sandbox = new SandboxPanel(s);
    this.audio = new GameAudio(s);
    for (let i = 0; i < 5; i++) {
      const l = el('div', 'mlabel');
      this.labels.push(l);
      this.root.appendChild(l);
    }
    this.root.append(this.vignette, this.tileLayer, this.crBars.root, this.top.root, this.status, this.minimaps.root, this.markers.root, this.build.root, this.info.root, this.boss.root, this.sandbox.root, this.goals, this.caption, this.toasts.root, this.paused, this.obsBar, this.menus.root, this.letterbox);
    (this.letterbox.querySelector('.skip') as HTMLElement).addEventListener('click', (e) => {
      e.stopPropagation();
      s.skipShot();
    });
    // Esc skips a story shot before anything else
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && s.cine) {
          s.skipShot();
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      },
      true,
    );
    // the battle arena has no nest, markers or economy: its own panel and scoreboard instead
    if (s.arena) {
      this.arena = new ArenaPanel(s);
      for (const e of [this.minimaps.root, this.markers.root, this.build.root, this.sandbox.root, this.goals]) e.style.display = 'none';
      this.root.classList.add('arena-mode');
      this.root.append(this.arena.root, this.arena.board);
      window.addEventListener('keydown', (e) => {
        // Shift+1..4: pick a team
        const k = /^Digit([1-4])$/.exec(e.code);
        if (!k || !e.shiftKey || !this.arena) return;
        const i = Number(k[1]) - 1;
        if (i < (arenaOf(s.world)?.teams.length ?? 0)) {
          s.arenaTeam = i;
          this.arena.refresh();
        }
      });
    }
    if (TOUCH) {
      this.root.classList.add('touch');
      this.root.appendChild(this.cancelChip);
      this.cancelChip.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.cancelChip.addEventListener('click', (e) => {
        e.stopPropagation();
        if (s.followId) s.unfollow();
        else if (s.tool !== 'none') s.setTool('none');
        else if (s.inspect) s.inspect = null;
      });
    }
    document.body.appendChild(this.cursorTip);
    this.tips = new Tips(this.root);
    this.menus.onScale = (k) => {
      this.userScale = k;
      this.applyScale();
    };
    this.applyScale();
    window.addEventListener('resize', () => this.applyScale());
    // Esc: close dialogs first, then the tool/follow (handled by the session), else open the menu.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code !== 'Escape' || s.input.rebindTarget) return;
        if (s.photoMode) {
          s.togglePhoto();
          e.stopImmediatePropagation();
          return;
        }
        if (this.menus.open) {
          this.menus.close();
          e.stopImmediatePropagation();
        } else if (s.tool === 'none' && !s.followId) {
          if (s.inspect) s.inspect = null;
          else this.menus.pause();
          e.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
    s.onPhoto = (on) => {
      this.root.style.display = on ? 'none' : '';
      this.cursorTip.classList.remove('show');
    };
    s.onEvent = (e) => this.event(e);
    s.onFrame = () => this.update();
    // F7 / F8: quick save and quick load (single-player)
    s.input.on('quickSave', () => {
      if (!s.canSave) return this.toasts.push('A multiplayer match cannot be saved.', 'info');
      void s.saveGame('quick').then((r) => r && this.toasts.push('Quick saved.', 'good'));
    });
    s.input.on('quickLoad', () => {
      if (!s.canSave) return;
      void getSave('quick').then((r) => (r ? this.menus.loadSlot('quick') : this.toasts.push('No quick save yet (F7 makes one).', 'info')));
    });
    // a new mission opens on its briefing (not a loaded one already under way)
    const m = missionOf(s.world);
    // (a story level skips it: the island hub showed its card, and the opening flight and captions follow)
    if (m && m.stage === 0 && !s.startSnapshot && !s.watchingReplay && !missionDef(m.id).story) setTimeout(() => this.menus.briefing(), 300);
  }

  /**
   * --ui: the interface is laid out for a 1600 × 900 window and scaled to fit
   * the actual one, from a small laptop window to 4K, so the bottom bar never
   * runs off the screen. The player's interface-size setting multiplies it,
   * but never beyond what fits across the width (on a wide screen there is
   * room to grow; on a 16:9 one, 100 % already fills it) or much past the height.
   */
  private applyScale(): void {
    const fitW = window.innerWidth / 1600;
    const fitH = window.innerHeight / 900;
    const fit = Math.min(fitW, fitH);
    let ui = Math.max(0.42, Math.min(fit * this.userScale, fitW, fitH * 1.3));
    // Touch: the full layout only while its buttons stay big enough for a finger (an iPad in landscape). Smaller
    // screens (phones in landscape, tablets in portrait) get the compact layout, laid out for about 1060 × 540:
    // maps behind a button, the build panel as a drawer, the marker panel narrower and folded to its heads.
    const compact = TOUCH && ui < 0.7;
    if (compact) ui = Math.max(0.5, Math.min(1.25, Math.min(window.innerWidth / 1060, window.innerHeight / 540) * this.userScale));
    if (compact !== this.compact) {
      this.compact = compact;
      this.root.classList.toggle('compact', compact);
      this.markers.root.classList.toggle('collapsed', compact);
      this.build.setOpen(!compact);
      this.minimaps.setOpen(!compact);
    }
    document.documentElement.style.setProperty('--ui', ui.toFixed(3));
  }

  private event(e: SimEvent): void {
    const pid = this.s.player.id;
    if (e.t === 'message' && e.kind === 'narrator') this.say(e.text, !!e.key);
    else if (e.t === 'message') this.toasts.push(e.text, e.kind === 'researcher' ? 'info' : e.kind);
    else if (e.t === 'queenHurt' && e.colony === pid) this.toasts.push('The queen is under attack!', 'warn', 'queen');
    // a titan digging toward the nest (sim/creatures/titanDig.ts): click to look
    else if (e.t === 'titanDig' && e.colony === pid && (e.phase === 'warn' || e.phase === 'breach')) {
      // (lower case for the sentence, but a proper name keeps its capital: "Mexican red-knee tarantula", "Carolina wolf spider")
      const name = (creatureKind(e.kind)?.name ?? 'titan').replace(/^(?!(?:Mexican|Carolina)\b)([A-Z])/, (c) => c.toLowerCase());
      const text = e.phase === 'warn' ? `${/^[aeiou]/.test(name) ? 'An' : 'A'} ${name} is digging toward your nest! Click to look.` : `The ${name} has broken into the nest!`;
      this.toasts.push(text, 'warn', `titan:${e.phase}`, () => this.s.jumpTo(e.phase === 'warn' ? 'surface' : 'nest', e.x, e.y, e.phase === 'warn' ? undefined : e.space));
    }
    else if (e.t === 'invasion' && e.colony === pid) this.toasts.push('Intruders in the nest!', 'warn', 'invasion');
    else if (e.t === 'colonyLost' && e.colony === pid) this.toasts.push('Your queen has died. The colony is lost.', 'warn');
    else if (e.t === 'colonyLost') {
      const w = this.s.world;
      const lost = w.colony(e.colony);
      const me = this.s.player;
      if (lost && lost.team === me.team) this.toasts.push(`An allied colony has fallen: ${lost.name}.`, 'warn');
      else {
        this.toasts.push(`A rival colony has fallen${lost ? ': ' + lost.name : ''}.`, 'good');
        // (single-player victory is shown by the end screen, from update())
      }
    }
    else if (e.t === 'bossPhase') {
      const cr = this.s.world.creatureById.get(e.creature);
      const k = cr ? CREATURES[cr.kind] : undefined;
      if (k && e.name) this.toasts.push(`${k.name}: ${e.name}`, 'warn');
    }
    this.boss.event(e);
  }

  private updateGoals(): void {
    const m = missionOf(this.s.world);
    this.goals.style.display = m && !m.result ? '' : 'none';
    if (!m) return;
    const info = this.s.missionInfo();
    // a level with nights: the clock and the night count (sim/story/dayNight.ts)
    const st = storyOf(this.s.world);
    const D = st ? missionDef(m.id).story?.dayNight : undefined;
    const t = this.s.world.s.time;
    const clock = D ? `<div class="gm-clock ${dayNightAt(D, t).night ? '' : 'day'}">${dayNightAt(D, t).night ? '☾' : '☀'} ${esc(dayNightLabel(D, t))}</div>` : '';
    const key = JSON.stringify([info.stage, info.goals, clock]);
    if (key === this.goalsKey) return;
    this.goalsKey = key;
    this.goals.innerHTML = `<div class="gm-stage">${esc(info.stage ?? '')}</div>${clock}${info.goals.map((g) => `<div class="gm-goal ${g.done ? 'done' : ''}"><span>${g.done ? '✓' : '○'} ${esc(g.text)}</span><b>${esc(g.progress)}</b></div>`).join('')}`;
  }

  /** A narrator caption: shown above the panels, for long enough to read it. */
  private say(text: string, story = false): void {
    // story levels: the narrator is named (she has no model; she is only these captions)
    if (story) this.caption.innerHTML = `<span class="who">Dr. Elena Varga · field journal</span>${esc(text)}`;
    else this.caption.textContent = text;
    this.caption.classList.add('show');
    this.captionT = performance.now() + 4000 + text.length * 55;
  }

  /** Single-player endings: a mission's result, or every rival (or your queen) fallen in a skirmish. */
  private checkEnd(): void {
    const s = this.s;
    if (this.ended || s.net || s.watchingReplay) return;
    const w = s.world;
    const me = s.player;
    const m = missionOf(w);
    let title = '';
    let text = '';
    let extra = '';
    if (m && missionDef(m.id)?.story) {
      if (!m.result) return;
      this.ended = true;
      this.storyEnd(m.result === 'won');
      return;
    }
    if (m) {
      if (m.result === 'won') {
        [title, text] = ['Mission complete', 'Every goal met and the finale won. You can keep playing in this world.'];
        const { record, best } = recordMedal(m.id, w.s.time, me.species);
        const t = `${Math.floor(w.s.time / 60)} min ${String(Math.floor(w.s.time % 60)).padStart(2, '0')} s`;
        extra = best ? `Finished in ${t}: <b class="medal ${record.medal}">${record.medal}</b>${record.medal !== 'gold' ? ` (gold is under 25 min)` : ''}.` : `Finished in ${t}. Your best stays <b class="medal ${record.medal}">${record.medal}</b>.`;
      }
      else if (m.result === 'lost') [title, text] = ['Mission failed', 'The queen is dead, and the colony with her.'];
    } else if (!me.alive) [title, text] = ['Defeat', 'Your queen has died. The colony is lost.'];
    else if (!s.sandbox) {
      const rivals = w.s.colonies.filter((c) => c.team !== me.team);
      if (rivals.length && rivals.every((c) => !c.alive)) [title, text] = ['Victory', 'Every rival queen has fallen. The ground is yours.'];
    }
    if (!title) return;
    this.ended = true;
    this.audio.stinger(title === 'Mission complete' || title === 'Victory');
    this.menus.result(title, text, extra);
  }

  /** A story level's end: the campaign records it, then the level-end screen. */
  private storyEnd(won: boolean): void {
    const s = this.s;
    const w = s.world;
    const st = storyOf(w);
    const m = missionOf(w)!;
    const L = missionDef(m.id).story!;
    this.audio.stinger(won);
    const nav = (q: string) => (location.href = `${location.pathname}?${q}`);
    const hub = () => nav('story=1');
    // a restart skips the opening flight (the boss rule: straight to the preparation)
    const retry = () => nav(`story=${L.id}&diff=${st?.diff ?? 'normal'}${st?.loadout.length ? `&loadout=${st.loadout.join(',')}` : ''}&retry=1`);
    const caste = L.reward.caste;
    if (!won) {
      recordLoss(L.id);
      showStoryEnd(this.root, { won, title: L.title, newCastes: [], reward: caste, rewardStolen: false, trait: L.reward.trait, quote: storyText(`${L.id}.${L.lose}`), chapterDone: false }, { hub, retry, keep: () => {} });
      return;
    }
    const medals = storyMedals(w)!;
    const stolen = storyStolen(w, st?.loadout ?? []);
    const rewardStolen = !!caste && s.player.castes.includes(caste) && !(st?.loadout ?? []).includes(caste);
    const chapter = CHAPTERS.find((c) => c.levels.includes(L.id));
    const wasDone = !!chapter && chapter.levels.every((l) => campaign().levels[l]?.won);
    const first = firstMedal(L.medals);
    // the screen first (it covers the canvas), then the photograph (one render to the canvas, read back)
    const info = {
      won,
      title: L.title,
      medals,
      medalText: { first: first.name, time: first.need, losses: lossesNeed(L.medals), bonus: L.medals.bonus.text },
      newCastes: [] as string[],
      reward: caste,
      rewardStolen,
      trait: L.reward.trait,
      newTrait: false,
      shot: undefined as string | undefined,
      quote: storyText(`${L.id}.${L.win}`),
      chapterDone: false,
    };
    const shot = rewardStolen && caste ? s.portrait(caste) : undefined;
    const r = recordWin(L.id, st?.diff ?? 'normal', medals, stolen, rewardStolen && caste ? { caste, url: shot } : null, L.reward.trait);
    info.newCastes = r.newCastes;
    info.newTrait = r.newTrait;
    info.shot = shot;
    const nowDone = !!chapter && chapter.levels.every((l) => campaign().levels[l]?.won);
    if (nowDone && !wasDone && chapter) {
      info.chapterDone = true;
      // the chapter's closing line belongs to its last level (whichever level completed the chapter)
      info.quote = `${info.quote} ${storyText(`${chapter.levels[chapter.levels.length - 1]}.ending`)}`.trim();
    }
    showStoryEnd(this.root, info, { hub, retry, keep: () => {} });
  }

  private update(): void {
    this.tick++;
    this.audio.update();
    // story shots: letterbox bars, the HUD out of the way
    const cine = !!this.s.cine;
    if (this.letterbox.classList.contains('show') !== cine) {
      this.letterbox.classList.toggle('show', cine);
      this.root.classList.toggle('cine', cine);
    }
    if (this.captionT && performance.now() > this.captionT) {
      this.captionT = 0;
      this.caption.classList.remove('show');
    }
    const s = this.s;
    this.markers.update();
    const first = this.tick < 3;
    this.minimaps.update(first);
    if (first || this.tick % 4 === 0) {
      this.top.update();
      this.build.update();
      this.info.update();
      this.boss.update();
      this.crBars.update();
      this.sandbox.update();
      this.arena?.update();
      this.updateGoals();
      this.checkEnd();
    }
    // marker count labels under each world marker
    const pos = s.markerScreenPositions();
    for (let i = 0; i < 5; i++) {
      const l = this.labels[i];
      const p = pos[i];
      if (!p || s.view.transitioning) {
        l.style.display = 'none';
        continue;
      }
      if (l.style.display !== 'block') l.style.display = 'block';
      l.style.left = p.x + 'px';
      l.style.top = p.y + 'px';
      const txt = String(markerCounts(s.world, s.player, i).current);
      if (l.textContent !== txt) l.textContent = txt;
    }
    // placement feedback at the cursor
    const msg = s.hoverMsg || (s.tool === 'tile' ? s.ghostInfo : s.tool === 'arena' ? s.arenaPlaceInfo() : '') || s.entranceTip;
    if (msg) {
      if (this.cursorTip.textContent !== msg) this.cursorTip.textContent = msg;
      this.cursorTip.classList.add('show');
      this.cursorTip.classList.toggle('bad', !!s.hoverMsg);
      this.cursorTip.style.left = s.input.mouseX + 18 + 'px';
      this.cursorTip.style.top = s.input.mouseY + 16 + 'px';
    } else this.cursorTip.classList.remove('show');
    this.paused.classList.toggle('show', s.loop.paused && !this.menus.open);
    // status line: starving brood
    this.starvingT = s.player.starving ? this.starvingT + 1 : 0;
    const st = this.starvingT > 30 ? 'The colony is starving. There is not enough food to feed the new brood.' : '';
    if (this.status.textContent !== st) this.status.textContent = st;
    this.status.classList.toggle('show', !!st);
    // queen in danger: the screen edges flash red below 25 % health
    const q = s.world.antById.get(s.player.queen);
    const danger = !!q && q.hp > 0 && q.hp < q.maxHp * 0.25;
    this.vignette.classList.toggle('show', danger);
    // tile info overlay and upgrade-point hints
    const labels = s.tileLabels();
    while (this.tileEls.length < labels.length) {
      const e = el('div', 'tlabel');
      this.tileLayer.appendChild(e);
      this.tileEls.push(e);
    }
    this.tileEls.forEach((e, i) => {
      const l = labels[i];
      if (!l) {
        if (e.style.display !== 'none') e.style.display = 'none';
        return;
      }
      // (written only when they change: an unchanged class or display still costs a style pass every frame)
      if (e.style.display !== 'block') e.style.display = 'block';
      e.style.left = l.x + 'px';
      e.style.top = l.y + 'px';
      const cls = 'tlabel ' + l.kind;
      if (e.className !== cls) e.className = cls;
      if (e.innerHTML !== l.html) e.innerHTML = l.html;
    });
    const follow = s.followId ? s.world.antById.get(s.followId) : undefined;
    this.obsBar.classList.toggle('show', !!follow);
    if (follow && this.tick % 10 === 0) this.obsBar.innerHTML = `<span class="sc">Observing</span><span style="color:var(--ink-dim)">${TOUCH ? 'Pinch zooms · drag orbits' : 'Wheel zooms · drag orbits · Esc stops'}</span>`;
    if (TOUCH) {
      // the touch stand-in for Esc / right-click: cancel the tool, stop following
      const label = follow ? 'Stop observing' : s.tool !== 'none' ? `Cancel ${TOOL_NAMES[s.tool] ?? 'tool'}` : '';
      this.cancelChip.classList.toggle('show', !!label);
      const html = `<span class="x">✕</span>${label}`;
      if (label && this.cancelChip.innerHTML !== html) this.cancelChip.innerHTML = html;
    }
  }
}
