import type { StoryShotData } from '../core/events';
import type { SurfaceCameraRig } from '../render/cameras';
import type { World } from '../sim/world';
import { storyOf } from '../sim/story/state';
import { members } from '../sim/story/director';

/**
 * In-engine shots for story levels (claude/story/02-spec §2 "Presentation"): the surface camera flies through a few
 * keys — fixed story points, or an actor it follows while it walks — under letterbox bars, then hands the camera back.
 * Client-side only (the simulation never waits on it), skippable, and short: the opening flight is about ten seconds,
 * the shots during play about five. The opening flight ends where the player starts; other shots return the camera
 * to where the player left it.
 */

interface Key {
  x: number;
  z: number;
  /** follow this actor (its first living member) instead */
  actor?: string;
  dist: number;
  yaw: number;
  pitch: number;
  t: number;
}

const smooth = (u: number) => u * u * (3 - 2 * u);

export class Cinematic {
  private keys: Key[] = [];
  private t = 0;
  private readonly end: number;
  private back: { x: number; z: number; dist: number; yaw: number; pitch: number } | null = null;
  done = false;

  constructor(
    shot: StoryShotData,
    private world: World,
    private rig: SurfaceCameraRig,
  ) {
    const story = world.terrain.map?.story;
    const pt = (at: unknown): { x: number; z: number; actor?: string } => {
      if (typeof at === 'string') {
        const p = story?.points[at];
        return p ? { x: p[0], z: p[1] } : { x: rig.goal.x, z: rig.goal.z };
      }
      if (Array.isArray(at)) return { x: at[0], z: at[1] };
      const a = (at as { actor: string }).actor;
      return { x: rig.goal.x, z: rig.goal.z, actor: a };
    };
    if (shot === 'flight') {
      for (const k of story?.flight ?? []) this.keys.push({ x: k.at[0], z: k.at[1], dist: k.dist, yaw: k.yaw, pitch: k.pitch ?? 0, t: k.t });
    } else {
      for (const k of shot.keys) this.keys.push({ ...pt(k.at), dist: k.dist, yaw: k.yaw, pitch: k.pitch ?? 0, t: k.t });
      this.back = { x: rig.goal.x, z: rig.goal.z, dist: rig.goalDistance, yaw: rig.goalYaw, pitch: rig.pitchBias };
    }
    this.end = (this.keys[this.keys.length - 1]?.t ?? 0) + (this.back ? 1.4 : 0.8);
    if (!this.keys.length) {
      this.done = true;
      return;
    }
    // start on the first key
    const k0 = this.resolve(this.keys[0]);
    rig.jumpTo(k0.x, k0.z, k0.dist);
    rig.yaw = rig.goalYaw = k0.yaw;
    rig.pitchBias = k0.pitch;
  }

  /** Where a key looks now (an actor's first living member while it is on the map). */
  private resolve(k: Key): Key {
    if (!k.actor) return k;
    const st = storyOf(this.world);
    const act = st?.actors.find((a) => a.name === k.actor);
    const e = act ? members(this.world, act)[0] : undefined;
    return e ? { ...k, x: e.x, z: e.y } : k;
  }

  /** Steer the camera; false once the shot is over (the camera is back with the player). */
  update(dt: number): boolean {
    if (this.done) return false;
    this.t += dt;
    const ks = this.keys;
    let i = 0;
    while (i < ks.length - 1 && this.t > ks[i + 1].t) i++;
    const a = this.resolve(ks[i]);
    const b = this.resolve(ks[Math.min(i + 1, ks.length - 1)]);
    const span = Math.max(0.001, b.t - a.t);
    const u = i >= ks.length - 1 ? 1 : smooth(Math.min(1, Math.max(0, (this.t - a.t) / span)));
    const r = this.rig;
    r.goal.x = a.x + (b.x - a.x) * u;
    r.goal.z = a.z + (b.z - a.z) * u;
    r.goalDistance = a.dist + (b.dist - a.dist) * u;
    r.goalYaw = a.yaw + (b.yaw - a.yaw) * u;
    r.pitchBias = a.pitch + (b.pitch - a.pitch) * u;
    if (this.t >= this.end) this.finish();
    return !this.done;
  }

  /** End now (Skip, or the shot is over): a mid-level shot gives the camera back where the player left it. */
  finish(): void {
    if (this.done) return;
    this.done = true;
    const r = this.rig;
    if (this.back) {
      r.goal.x = this.back.x;
      r.goal.z = this.back.z;
      r.goalDistance = this.back.dist;
      r.goalYaw = this.back.yaw;
      r.pitchBias = this.back.pitch;
    } else {
      const k = this.keys[this.keys.length - 1];
      if (k) {
        r.goal.x = k.x;
        r.goal.z = k.z;
        r.goalDistance = k.dist;
        r.goalYaw = k.yaw;
      }
      r.pitchBias = 0;
    }
  }
}
