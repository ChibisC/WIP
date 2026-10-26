import { SOUNDS } from '../audio/catalog';
import { audio } from '../audio/engine';
import { Ambience } from '../audio/ambience';
import { Music } from '../audio/music';
import { GrainBed } from '../audio/beds';
import type { MapStyle } from '../world/terrain';

/**
 * ?scene=sounds: the sound board. Every sound in the catalog with its takes,
 * whether it plays a recording or its stand-in, and a mixer to hear the
 * soundscape without a game: biome, surface or nest, night, zoom, rain,
 * the swarm, a battle and a boss. For auditioning recordings as they are
 * added (docs/audio/sound-list.md).
 */
export function runSoundBoard(ui: HTMLElement): void {
  const root = document.createElement('div');
  root.className = 'sound-board';
  ui.appendChild(root);
  const groups = [...new Set(SOUNDS.map((s) => s.group))];
  const st = { style: 'meadow' as MapStyle, surface: 1, night: 0, zoom: 0.3, rain: 0, ants: 0, fight: 0, boss: 0, on: false };
  const slider = (key: keyof typeof st, label: string) => `<label>${label}<input type="range" min="0" max="100" value="${Math.round((st[key] as number) * 100)}" data-k="${key}"></label>`;
  root.innerHTML = `
    <h1>Sound board</h1>
    <p class="dim">Click anywhere to start the audio. <b>file</b> = a recording from public/audio; <b>stand-in</b> = synthesised from the physics of the real sound until a recording is added (docs/audio/sound-list.md).</p>
    <div class="sb-mix">
      <button data-mix="1">▶ Soundscape</button>
      <label>Biome <select data-k="style">${['meadow', 'forest', 'sandy', 'riverbank', 'formicarium'].map((s) => `<option>${s}</option>`).join('')}</select></label>
      ${slider('surface', 'Surface ↔ nest')}${slider('night', 'Night')}${slider('zoom', 'Zoom out')}${slider('rain', 'Rain')}${slider('ants', 'Swarm')}${slider('fight', 'Battle')}${slider('boss', 'Boss')}
    </div>
    ${groups
      .map(
        (g) => `<h2>${g}</h2><div class="sb-grid">${SOUNDS.filter((s) => s.group === g)
          .map((s) => {
            const src = audio.bank.source(s);
            return `<div class="sb-row"><button data-id="${s.id}">▶</button><code>${s.id}</code><span class="src ${src}">${src}</span><span class="takes">${Array.from({ length: s.loop ? 1 : Math.max(1, s.takes) }, (_, i) => `<button class="t" data-id="${s.id}" data-take="${i + 1}">${i + 1}</button>`).join('')}</span><span class="dim">${s.desc}${s.reserved ? ` <i>(${s.reserved})</i>` : ''}</span></div>`;
          })
          .join('')}</div>`,
      )
      .join('')}`;
  const style = document.createElement('style');
  style.textContent = `
    .sound-board { position: absolute; inset: 0; overflow: auto; padding: 20px 28px; color: #efe3c8; font: 13px/1.4 system-ui, sans-serif; background: #120c08; z-index: 5 }
    .sound-board h1 { font-family: serif; margin: 0 0 4px } .sound-board h2 { font-family: serif; font-weight: 500; margin: 18px 0 6px; color: #e0c28a }
    .sound-board .dim { color: #a8977a } .sound-board button { background: #2c2116; color: #efe3c8; border: 1px solid #a8844f; border-radius: 3px; cursor: pointer; padding: 2px 8px }
    .sb-row { display: grid; grid-template-columns: 34px 210px 70px 170px 1fr; gap: 8px; align-items: center; padding: 3px 0; border-bottom: 1px solid #2a2018 }
    .sb-row .t { padding: 1px 5px; margin-right: 2px; font-size: 11px } .src.file { color: #9be07c } .src.stand-in { color: #e0c28a } .src.none { color: #c66 }
    .sb-mix { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; padding: 10px; border: 1px solid #5a4428; border-radius: 4px; margin: 10px 0 }
    .sb-mix label { display: flex; gap: 6px; align-items: center } .sb-mix input { width: 110px; accent-color: #c9a25a } .sb-mix select { background: #2c2116; color: #efe3c8; border: 1px solid #a8844f }`;
  document.head.appendChild(style);
  root.addEventListener('click', (e) => {
    audio.unlock();
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    b.dataset.silent = '1';
    if (b.dataset.mix) {
      st.on = !st.on;
      b.textContent = st.on ? '■ Soundscape' : '▶ Soundscape';
      return;
    }
    const id = b.dataset.id;
    if (!id) return;
    const play = () => audio.play(id, { take: b.dataset.take ? Number(b.dataset.take) : undefined });
    if (!play()) setTimeout(play, 120);
  });
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const k = t.dataset.k as keyof typeof st | undefined;
    if (!k) return;
    if (k === 'style') st.style = t.value as MapStyle;
    else (st as Record<string, unknown>)[k] = Number(t.value) / 100;
  });
  const amb = new Ambience();
  const music = new Music();
  const swarm = new GrainBed('ant.swarm_bed');
  const battle = new GrainBed('combat.battle_bed');
  let last = performance.now();
  let fightT = 0;
  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.2, (now - last) / 1000);
    last = now;
    if (audio.ctx) {
      const on = st.on ? 1 : 0;
      amb.update({ style: st.style, surface: on ? st.surface : 0, night: st.night, zoom: st.zoom, rain: st.rain * on, activity: 0.5 * on });
      swarm.level = on * st.ants;
      swarm.density = 10 + 70 * st.ants;
      swarm.update();
      battle.level = on * Math.max(0, st.fight - 0.4) * 1.5;
      battle.density = 15 + 60 * st.fight;
      battle.update();
      if (on) music.update(dt, st.fight, st.boss);
      // a battle also fires single combat sounds, like the game does
      fightT -= dt;
      if (on && st.fight > 0.05 && fightT <= 0) {
        fightT = 0.4 / (0.2 + st.fight * 4);
        const ids = ['combat.mandible_click', 'combat.mandible_snap', 'combat.chitin_crack', 'combat.sting', 'combat.acid_spray', 'combat.ant_death'];
        audio.play(ids[Math.floor(Math.random() * ids.length)], { gain: 0.5 + Math.random() * 0.5, pan: Math.random() * 1.6 - 0.8 });
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  (window as unknown as { __board: unknown }).__board = { st, audio };
}
