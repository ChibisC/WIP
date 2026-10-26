/**
 * Order sounds (Phase 14 audio): every command the player issues gets a
 * quiet, natural confirmation at once (instant local feedback, multiplayer
 * brief Part C). Markers chirp at a different pitch for each of I–V; the
 * tools tap, puff and crumble like packed earth.
 */
import type { CommandBody } from '../sim/commands';
import { audio } from './engine';

let last = 0;
/** marker I–V: a pentatonic set of pitches, so they are easy to tell apart */
const MARKER_RATE = [1, 1.125, 1.26, 1.5, 1.68];

export function uiCommand(body?: CommandBody): void {
  if (!audio.ctx) return;
  const t = audio.now;
  // painting dig or tiles issues a command per hex: keep it to a gentle patter
  if (t - last < (body?.type === 'dig' ? 0.07 : 0.03)) return;
  last = t;
  switch (body?.type) {
    case 'placeMarker':
      audio.play('ui.marker', { rate: MARKER_RATE[body.i] ?? 1 });
      return;
    case 'removeMarker':
      audio.play('ui.marker_lift');
      return;
    case 'assignGroup':
      audio.play('ui.group_assign');
      return;
    case 'dig':
      audio.play(body.on ? 'ui.tool_dig' : 'ui.marker_lift', { gain: 0.8 });
      return;
    case 'buildTile':
      audio.play('ui.tool_build');
      return;
    case 'markUpgrade':
      audio.play('ui.tool_upgrade');
      return;
    case 'markDelete':
      audio.play('ui.tool_delete');
      return;
    default:
      audio.play('ui.menu_tap');
  }
}

/** Kept for callers that have no command body. */
export function uiClick(): void {
  uiCommand();
}
