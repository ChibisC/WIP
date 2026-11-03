import './story.css';
import { esc } from './dom';
import { stolenName } from '../sim/termants';
import { antSilhouette } from './icons';
import { CASTES } from '../sim/species';
import type { MedalTier, StoryMedals } from '../sim/story/runner';
import { STORY } from '../sim/balance';

/**
 * The end of a story level: on a win the three medals (time or food stored, losses, bonus), what the win keeps — the
 * stolen caste with the field journal's photograph, or a boss's trait — the narrator's last line, and once the chapter
 * is complete the chapter-complete note. On a loss: try again or back to the island. Buttons only call back into
 * main.ts (page navigation).
 */

export interface StoryEndInfo {
  won: boolean;
  title: string;
  medals?: StoryMedals;
  /** the first medal's name (Time, Food stored) and what each medal asks */
  medalText?: { first: string; time: string; losses: string; bonus: string };
  /** castes kept by this win (new to the campaign) */
  newCastes: string[];
  /** the level's reward caste (none: a level that gives medals or a trait) and whether it was stolen */
  reward?: string;
  rewardStolen: boolean;
  /** the level's reward trait (STORY.traits), and whether this win added it */
  trait?: string;
  newTrait?: boolean;
  shot?: string;
  quote: string;
  chapterDone: boolean;
}

const TIER: Record<MedalTier, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze', none: 'Not earned' };

export function showStoryEnd(parent: HTMLElement, info: StoryEndInfo, act: { hub: () => void; retry: () => void; keep: () => void }): HTMLElement {
  const root = document.createElement('div');
  root.className = 'story-end';
  const m = info.medals;
  const t = m ? `${Math.floor(m.seconds / 60)} min ${String(Math.floor(m.seconds % 60)).padStart(2, '0')} s` : '';
  const medal = (tier: MedalTier, name: string, sub: string) => `<div class="se-m ${tier}"><i></i><b>${name}</b><span>${esc(TIER[tier])}</span><span>${esc(sub)}</span></div>`;
  const T = info.trait ? STORY.traits[info.trait] : undefined;
  const gain = !info.won
    ? ''
    : T
      ? `<div class="se-gain"><div><span class="sh-kicker">${info.newTrait ? 'A trait for the campaign' : 'Already in the genome'}</span><b>${esc(T.name)}</b><span class="sh-dim">${esc(T.desc)} It stays with the colony in every story level.</span></div></div>`
      : !info.reward
        ? ''
        : info.rewardStolen
      ? `<div class="se-gain">${info.shot ? `<img alt="" src="${info.shot}">` : antSilhouette(CASTES[info.reward]?.role ?? 'soldier', '#d6b072')}<div><span class="sh-kicker">${info.newCastes.length ? 'Kept for the campaign' : 'Already in the genome'}</span><b>${esc(stolenName(info.reward))}</b><span class="sh-dim">${info.newCastes.length ? 'It can be brought into later levels from the island map (one stolen-caste slot).' : 'Its journal page has a new photograph.'}</span></div></div>`
          : `<div class="se-gain"><div><span class="sh-kicker">Not stolen</span><b>${esc(stolenName(info.reward))}</b><span class="sh-dim">The level is won, but the caste was not stolen. Play it again to take it.</span></div></div>`;
  root.innerHTML = `<div class="se-card">
    <h1>${info.won ? 'Level complete' : 'The colony is lost'}</h1>
    <p class="se-sub">${esc(info.title)}${info.won ? ` · ${t}` : ''}</p>
    ${m && info.won ? `<div class="se-medals">${medal(m.time, info.medalText?.first ?? 'Time', m.food !== undefined ? `${m.food} food stored` : (info.medalText?.time ?? ''))}${medal(m.losses, 'Losses', `${m.lost} ants lost`)}${medal(m.bonus, 'Bonus', info.medalText?.bonus ?? '')}</div>` : ''}
    ${gain}
    <div class="se-quote">${esc(info.quote)}<br><span class="sh-dim">— Dr. Elena Varga, field journal</span></div>
    ${info.chapterDone ? `<div class="sh-banner" style="position:static;transform:none;margin:0 0 14px"><b>Chapter 1 complete</b><span>More of the island is coming soon.</span></div>` : ''}
    <div class="se-btns">
      ${info.won ? '<button data-a="keep">Keep playing here</button>' : '<button data-a="retry">Try again</button>'}
      <button class="main" data-a="hub">Back to the island</button>
    </div></div>`;
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    if (b.dataset.a === 'keep') {
      root.remove();
      act.keep();
    } else if (b.dataset.a === 'retry') act.retry();
    else if (b.dataset.a === 'hub') act.hub();
  });
  parent.appendChild(root);
  return root;
}
