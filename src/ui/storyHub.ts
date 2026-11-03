import './story.css';
import { IslandMap, NodeView } from './islandMap';
import { CHAPTERS, NODES, REGIONS } from '../story/campaign';
import { STORY_LEVELS } from '../story/levels';
import { storyText } from '../story/text';
import { campaign, isUnlocked, resetCampaign, saveCampaign, slots } from '../game/campaign';
import { DIFFICULTIES, Difficulty, StoryLevelDef } from '../sim/story/types';
import { STOLEN_CASTES, stolenName } from '../sim/termants';
import { CASTES, SPECIES } from '../sim/species';
import { antSilhouette } from './icons';
import { esc } from './dom';
import { STORY } from '../sim/balance';
import { firstMedal, lossesNeed } from '../story/medalText';

/**
 * The campaign hub (claude/story/02-spec §3): the island map with the chapter's level nodes, and beside it the
 * selected level's card — its brief, medals, difficulty and the stolen-caste loadout — plus the Genome screen (the
 * castes kept in the campaign) and the field journal. Start hands the choice to main.ts.
 */

export interface StoryStart {
  level: StoryLevelDef['id'];
  difficulty: Difficulty;
  loadout: string[];
}

type LevelId = StoryLevelDef['id'];
const DIFF_NAMES: Record<Difficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', brutal: 'Brutal' };
const DIFF_TIPS: Record<Difficulty, string> = {
  easy: 'Weaker enemies, smaller waves, more food to start.',
  normal: 'The level as written.',
  hard: 'Stronger enemies, bigger waves, a more aggressive rival.',
  brutal: 'Much stronger enemies and waves; little food. For a second play.',
};
const TIER: Record<string, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze', none: '—' };
const mmss = (s: number) => `${Math.floor(s / 60)} min`;

function nodeViews(): NodeView[] {
  const c = campaign();
  return NODES.map((n) => {
    const L = STORY_LEVELS[n.level];
    const rec = c.levels[n.level];
    return {
      node: n,
      state: rec?.won ? 'won' : isUnlocked(n.level) ? 'open' : 'locked',
      medals: rec?.won ? [rec.time, rec.losses, rec.bonus] : [],
      number: L.number,
      title: L.title,
    };
  });
}

/** What a level's win keeps: a stolen caste, a trait, or medals only. */
function rewardLine(L: StoryLevelDef): string {
  if (L.reward.caste) return `<div class="sh-steal">${antSilhouette(CASTES[L.reward.caste].role, '#c9a46a')}<div><span>Steal</span><b>${esc(stolenName(L.reward.caste))}</b></div></div>`;
  const T = L.reward.trait ? STORY.traits[L.reward.trait] : undefined;
  if (T) return `<div class="sh-steal"><div class="sh-trait">✦</div><div><span>Boss · a trait for the campaign</span><b>${esc(T.name)}</b></div></div>`;
  return `<div class="sh-steal"><div class="sh-trait">☾</div><div><span>Survive</span><b>Medals only</b></div></div>`;
}

export function showStoryHub(parent: HTMLElement, start: (s: StoryStart) => void, back: () => void): void {
  const c = campaign();
  const root = document.createElement('div');
  root.className = 'story-hub';
  parent.appendChild(root);
  let tab: 'island' | 'genome' | 'journal' = 'island';
  // the level to show first: the newest one open and not yet won, else the last one
  const open = NODES.filter((n) => isUnlocked(n.level));
  let sel: LevelId = (open.find((n) => !c.levels[n.level]?.won) ?? open[open.length - 1] ?? NODES[0]).level;
  const map = new IslandMap(nodeViews, (l) => c.revealed.includes(l as LevelId));
  map.selected = sel;
  map.onSelect = (l) => {
    sel = l as LevelId;
    renderCard();
    renderList();
  };
  map.onRevealed = (l) => {
    if (!c.revealed.includes(l as LevelId)) c.revealed.push(l as LevelId);
    saveCampaign();
  };
  const chapter = CHAPTERS[0];
  const done = chapter.levels.every((l) => c.levels[l]?.won);
  root.innerHTML = `
    <div class="sh-top">
      <div class="sh-title"><span class="sh-kicker">The Gene-Thief</span><b>${esc(chapter.name)}</b></div>
      <div class="sh-tabs">
        <button class="sh-tab on" data-tab="island">Island</button>
        <button class="sh-tab" data-tab="genome">Genome</button>
        <button class="sh-tab" data-tab="journal">Field journal</button>
      </div>
      <button class="sh-back" data-act="back">Main menu</button>
    </div>
    <div class="sh-body">
      <div class="sh-map"></div>
      <div class="sh-side"><div class="sh-list"></div><div class="sh-cardbox"></div></div>
    </div>
    <div class="sh-page" hidden></div>
    ${done ? `<div class="sh-banner"><b>Chapter 1 complete</b><span>More of the island is coming soon.</span></div>` : ''}`;
  const mapBox = root.querySelector('.sh-map') as HTMLElement;
  mapBox.appendChild(map.root);
  const side = root.querySelector('.sh-cardbox') as HTMLElement;
  const list = root.querySelector('.sh-list') as HTMLElement;
  // every level by chapter (the campaign runs to 30–40 levels: the list is the quick way round the island)
  const renderList = () => {
    list.innerHTML = CHAPTERS.map((ch) => {
      const rows = ch.levels
        .map((l) => {
          const L = STORY_LEVELS[l];
          const rec = c.levels[l];
          const st = rec?.won ? 'won' : isUnlocked(l) ? 'open' : 'locked';
          const medals = rec?.won ? [rec.time, rec.losses, rec.bonus].map((m) => `<i class="m ${m}"></i>`).join('') : '';
          return `<button class="sh-lv ${st} ${l === sel ? 'on' : ''}" data-lv="${l}"><span class="n">${L.number}</span><span class="t">${esc(L.title)}</span><span class="ms">${medals}</span></button>`;
        })
        .join('');
      return `<div class="sh-ch"><div class="sh-chname">${esc(ch.name)}</div>${rows}</div>`;
    }).join('');
  };
  renderList();
  const page = root.querySelector('.sh-page') as HTMLElement;
  const body = root.querySelector('.sh-body') as HTMLElement;

  const renderCard = () => {
    const L = STORY_LEVELS[sel];
    const node = NODES.find((n) => n.level === sel)!;
    const region = REGIONS.find((r) => r.id === node.region)!;
    const rec = c.levels[sel];
    const unlocked = isUnlocked(sel);
    const diff = c.difficulty[sel] ?? 'normal';
    const M = L.medals;
    const medal = (name: string, tier: string, need: string) => `<div class="sh-medal ${tier}"><i></i><div><b>${name}</b><span>${esc(need)}</span></div><em>${TIER[tier] ?? '—'}</em></div>`;
    const kept = c.castes.filter((cs) => CASTES[cs]);
    const nSlots = slots();
    const lo = (c.loadout[sel] ?? []).filter((cs) => kept.includes(cs)).slice(0, nSlots);
    const loadout = L.loadout
      ? `<h3>Stolen castes <span>${lo.length} / ${nSlots} slot${nSlots > 1 ? 's' : ''}</span></h3>
         <div class="sh-chips">${kept.length ? kept.map((cs) => `<button class="sh-chip ${lo.includes(cs) ? 'on' : ''}" data-caste="${cs}">${esc(stolenName(cs))}</button>`).join('') : '<span class="sh-dim">No stolen castes kept yet.</span>'}<button class="sh-chip ${lo.length ? '' : 'on'}" data-caste="">None</button></div>
         <p class="sh-dim">A caste you steal during the level can always be raised there, without a slot.</p>`
      : `<p class="sh-dim">This level starts with the base castes only.</p>`;
    side.innerHTML = `
      <div class="sh-card">
        <div class="sh-kicker">Level ${L.number} · ${esc(region.name)}</div>
        <h2>${esc(L.title)}</h2>
        <p>${esc(L.brief)}</p>
        ${rewardLine(L)}
        <h3>Medals ${rec?.won ? `<span>${M.food ? '' : `best ${mmss(rec.bestSeconds)}, `}${rec.bestLost} lost</span>` : ''}</h3>
        ${medal(firstMedal(M).name, rec?.time ?? 'none', firstMedal(M).need)}
        ${medal('Losses', rec?.losses ?? 'none', lossesNeed(M))}
        ${medal('Bonus', rec?.bonus ?? 'none', M.bonus.text)}
        <h3>Difficulty</h3>
        <div class="sh-chips">${DIFFICULTIES.map((d) => `<button class="sh-chip ${d === diff ? 'on' : ''}" data-diff="${d}" title="${esc(DIFF_TIPS[d])}">${DIFF_NAMES[d]}</button>`).join('')}</div>
        <p class="sh-dim">${esc(DIFF_TIPS[diff])}</p>
        ${loadout}
        ${unlocked ? `<button class="sh-go" data-act="start">${rec?.won ? 'Play again' : 'Start'}</button>` : `<div class="sh-locked">Win <b>${esc(STORY_LEVELS[node.after[0]]?.title ?? '')}</b> to open this level.</div>`}
      </div>`;
  };

  const renderGenome = () => {
    const kept = new Set(c.castes);
    // traits (story only): the bosses' gifts, built ones first, the planned ones as unknowns
    const traits = Object.entries(STORY.traits)
      .filter(([id, t]) => t.built || c.traits.includes(id))
      .map(([id, t]) => {
        const has = c.traits.includes(id);
        return `<div class="sh-gene ${has ? 'on' : ''}"><div class="sh-trait">✦</div><div><b>${has ? esc(t.name) : 'Unknown trait'}</b><span>${has ? esc(t.desc) : `From ${esc(t.from)}`}</span></div></div>`;
      })
      .join('');
    page.innerHTML = `<div class="sh-sheet"><h2>Genome</h2>
      <h3>Traits</h3><p class="sh-dim">Permanent gifts from the island’s titans: every story level, all your ants. They never come into skirmish or multiplayer.</p>
      <div class="sh-genome">${traits}</div><h3>Stolen castes</h3>
      <p class="sh-dim">Castes the Gene-Thief Termants have stolen and kept for the campaign. Bring up to <b>${slots()}</b> into a level (one more slot for every boss beaten, in later chapters).</p>
      <div class="sh-genome">${STOLEN_CASTES.map((e) => {
        const cd = CASTES[e.caste];
        const sp = SPECIES[e.source];
        const has = kept.has(e.caste);
        const where = NODES.find((n) => STORY_LEVELS[n.level].reward.caste === e.caste);
        return `<div class="sh-gene ${has ? 'on' : ''}">${antSilhouette(cd.role, has ? '#d6b072' : '#5b4c3a')}<div>
          <b>${has ? esc(stolenName(e)) : 'Unknown genome'}</b>
          <span>${has ? `<i>${esc(sp.scientific)}</i> · ${cd.length} mm · health ${cd.hp} · bite ${cd.bite}${cd.sting ? ' · venom sting' : ''}${cd.acid ? ' · formic acid' : ''}` : where ? `To be stolen in ${esc(STORY_LEVELS[where.level].title)}` : 'Somewhere else on the island'}</span>
          ${has ? `<p>${esc(cd.fact)}</p>` : ''}</div></div>`;
      }).join('')}</div></div>`;
  };

  const renderJournal = () => {
    const pages = NODES.map((n) => {
      const L = STORY_LEVELS[n.level];
      const j = c.journal.find((x) => x.level === n.level);
      if (!c.levels[n.level]?.won) return `<div class="sh-jpage blank"><b>${esc(L.title)}</b><span>Not yet written.</span></div>`;
      return `<div class="sh-jpage">
        <div class="sh-jhead"><b>${esc(storyText(`journal.${n.level}.title`))}</b><span>${esc(j?.date ?? '')}</span></div>
        ${j?.shot ? `<img alt="" src="${j.shot}">` : L.reward.caste ? `<div class="sh-jsil">${antSilhouette(CASTES[L.reward.caste].role, '#7a5c38')}<span>${c.castes.includes(L.reward.caste) ? 'No photograph taken' : 'The caste was not stolen: replay the level to take it.'}</span></div>` : ''}
        ${j?.caste ? `<div class="sh-jcap">${esc(stolenName(j.caste))}, raised by the Gene-Thief Termants</div>` : ''}
        <p>${esc(storyText(`journal.${n.level}.body`))}</p>
        <p class="sh-jnote">${esc(storyText(`journal.${n.level}.note`))}</p>
      </div>`;
    }).join('');
    page.innerHTML = `<div class="sh-sheet journal"><h2>Field journal</h2><p class="sh-dim">Dr. Elena Varga’s notes on the species of Wayfarer Island.</p><div class="sh-journal">${pages}</div>
      <div class="sh-reset"><button class="sh-chip" data-act="reset">Start the campaign over…</button></div></div>`;
  };

  renderCard();
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    const d = b.dataset;
    if (d.lv) {
      sel = d.lv as LevelId;
      map.selected = sel;
      map.focus(sel);
      renderCard();
      renderList();
      return;
    }
    if (d.tab) {
      tab = d.tab as typeof tab;
      root.querySelectorAll('.sh-tab').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.tab === tab));
      body.hidden = tab !== 'island';
      page.hidden = tab === 'island';
      if (tab === 'genome') renderGenome();
      if (tab === 'journal') renderJournal();
      return;
    }
    if (d.diff) {
      c.difficulty[sel] = d.diff as Difficulty;
      saveCampaign();
      renderCard();
      return;
    }
    if (d.caste !== undefined) {
      const cur = c.loadout[sel] ?? [];
      if (!d.caste) c.loadout[sel] = [];
      else if (cur.includes(d.caste)) c.loadout[sel] = cur.filter((x) => x !== d.caste);
      else c.loadout[sel] = [...cur, d.caste].slice(-slots());
      saveCampaign();
      renderCard();
      return;
    }
    if (d.act === 'reset') {
      if (b.dataset.sure) {
        resetCampaign();
        map.dispose();
        root.remove();
        showStoryHub(parent, start, back);
      } else {
        b.dataset.sure = '1';
        b.textContent = 'Click again to erase the campaign';
      }
      return;
    }
    if (d.act === 'back') {
      map.dispose();
      root.remove();
      back();
      return;
    }
    if (d.act === 'start' && isUnlocked(sel)) {
      const L = STORY_LEVELS[sel];
      const lo = L.loadout ? (c.loadout[sel] ?? []).filter((cs) => c.castes.includes(cs)).slice(0, slots()) : [];
      map.dispose();
      root.remove();
      start({ level: sel, difficulty: c.difficulty[sel] ?? 'normal', loadout: lo });
    }
  });
}
