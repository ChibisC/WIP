import type * as THREE from 'three';
import type { NestGrid } from '../../world/nestGrid';
import type { HexVisual } from './nestTerrain';

/**
 * What a per-space view (game/nestView.ts) needs of the ground it draws on: the nest's soil (render/nest/nestTerrain.ts)
 * and the trees' canopy (render/trees/canopyTerrain.ts) both give it, so one `NestView` draws the ants, food, creatures,
 * markers and effects of either kind of space.
 */
export interface AreaTerrain {
  group: THREE.Group;
  grid: NestGrid;
  /** the walls' (or branches') height over the floor plane (mm) */
  wallH: number;
  uniforms: {
    uGrid: { value: number };
    uGhost: { value: THREE.Vector4 };
    uGhostCol: { value: THREE.Color };
    uMarkerCols: { value: THREE.Color[] };
    uSelected: { value: THREE.Vector3 };
    uCarton: { value: number };
    uEntR: { value: number };
  };
  /** the drawn surface (walls and ramps included) and the floor ants walk on */
  heightAt(px: number, py: number): number;
  normalAt(px: number, py: number, out: THREE.Vector3): THREE.Vector3;
  floorAt(px: number, py: number): number;
  floorNormalAt(px: number, py: number, out: THREE.Vector3): THREE.Vector3;
  setHexes(get: (q: number) => HexVisual | null): void;
  setShut(tops: number[]): void;
  isShut(top: number): boolean;
  setSealed(hexes: ReadonlySet<number> | null): void;
  setFog(level: ((q: number) => number) | null): void;
  /** chunks waiting for a rebuild */
  readonly dirty: number;
  /**
   * Has the mesh caught up with the ground as it was at `version` (its signed distance and maps computed from it or
   * later, at most a few chunks left)? A dive or a cut into an area waits for this (performance v4).
   */
  caughtUp(version: number): boolean;
  update(force?: boolean, budgetMs?: number): void;
  rebuildAll(): void;
  setShadows(on: boolean): void;
  /** performance v5: only the parts that can shadow what is on screen cast into a fixed light's shadow map */
  cullShadowCasters?(box: { x0: number; x1: number; z0: number; z1: number } | null): void;
  /** the highest the mesh rises over the floor (mm) */
  readonly topHeight?: number;
}
