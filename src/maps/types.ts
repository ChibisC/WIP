/**
 * Authored surface maps (docs/maps/design.md). A map is data only: shapes in mm on the
 * map plane (x right, y "down the screen" = world z), rasterised deterministically by
 * `world/surfaceLayout.ts` and drawn into the terrain by `world/terrain.ts`.
 */
import type { MapStyle } from '../world/terrain';

export type MapId = 'meadowPond' | 'forestFloor' | 'riverbank' | 'rainforest' | 'savanna' | 'testPond';

/** A point in mm. */
export type Pt = readonly [number, number];

/**
 * A shape on the map plane. Distances are signed: negative inside.
 * - poly: a closed polygon (any winding)
 * - path: a polyline with a width (round caps)
 * - circle, ellipse (rot in radians)
 */
export type Shape =
  | { readonly poly: readonly Pt[] }
  | { readonly path: readonly Pt[]; readonly width: number }
  | { readonly circle: Pt; readonly r: number }
  | { readonly ellipse: Pt; readonly rx: number; readonly ry: number; readonly rot?: number };

export interface HeightBrush {
  shape: Shape;
  /** mm: + raises a hill or bank, − sinks a hollow */
  amount: number;
  /** mm over which the brush fades out beyond the shape's edge */
  falloff: number;
}

export type WaterKind = 'pond' | 'stream' | 'puddle' | 'pool' | 'waterhole';

export interface WaterBody {
  kind: WaterKind;
  shape: Shape;
  /** water surface height (mm, on the map's datum: open ground lies around 0) */
  level: number;
  /** basin depth below the level at its deepest */
  depth: number;
  /** mm from the edge to full depth (the slope of the bed) */
  bed?: number;
}

export type WalkwayKind = 'stone' | 'leaf' | 'rootMat' | 'moss';

export interface Walkway {
  kind: WalkwayKind;
  /** a path with a width (≥ 28 mm) across water, reaching onto land at both ends */
  shape: Shape;
}

export type WallKind = 'log' | 'rock' | 'trunk' | 'buttress' | 'mushrooms' | 'pineCone' | 'stone' | 'termiteMound';

export interface Wall {
  kind: WallKind;
  shape: Shape;
  /** visual height (mm); walls block whatever their height */
  height: number;
}

export interface Site {
  /** nest centre (mm); snapped to the nearest hex */
  at: Pt;
  /** mound footprint radius in hexes (1: 7 hexes, 2: 19) */
  footprint?: 1 | 2;
  /** 1–3 entrances (mm), on or just outside the footprint */
  entrances: readonly Pt[];
}

export type ZoneKind = 'food' | 'aphid' | 'plant' | 'lair' | 'creature' | 'noSpawn' | 'litter';

export interface Zone {
  kind: ZoneKind;
  shape: Shape;
  /** relative spawn weight among zones of the same kind */
  weight?: number;
  name?: string;
}

export interface FloodZone {
  shape: Shape;
  /** flood water level while flooded (mm, datum) */
  level: number;
  /** seconds: first storm, then the gap between storms, and how long the water holds */
  first: readonly [number, number];
  every: readonly [number, number];
  hold: readonly [number, number];
}

export type Biome = 'meadow' | 'forest' | 'riverbank' | 'rainforest' | 'savanna';

export interface MapDef {
  id: MapId;
  name: string;
  blurb: string;
  biome: Biome;
  /** the procedural style whose ground cover, grass and sound the map borrows until its own art pass */
  style: MapStyle;
  width: number;
  depth: number;
  /** surface hex circumradius (mm) */
  hexR: number;
  /** the seeded relief under everything: amplitude (mm) and feature scale (mm) */
  relief: { amp: number; scale: number };
  brushes: HeightBrush[];
  water: WaterBody[];
  walkways: Walkway[];
  walls: Wall[];
  /** exactly 10 on the five maps (test maps may have fewer) */
  sites: Site[];
  /** balanced site sets by colony count; the 10-colony set lists every site */
  siteSets: { 2: number[][]; 3: number[][]; 4: number[][]; 10: number[][] };
  zones: Zone[];
  floods: FloodZone[];
  /** sparse per-hex type paint from the editor, applied last: [hex index, HexType] */
  overrides?: [number, number][];
}
