/**
 * Original line-art icon set (24×24, currentColor) and top-down ant
 * silhouettes for caste cards. All drawn for this game.
 */
const svg = (body: string, vb = '0 0 24 24') => `<svg viewBox="${vb}" class="ic" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const hexPts = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`;
  }).join(' ');

export const ICONS = {
  home: svg(`<polygon points="${hexPts(12, 12, 9.5)}"/><polygon points="${hexPts(12, 12, 4)}" fill="currentColor" stroke="none" opacity=".75"/>`),
  hammer: svg(`<path d="M14.5 4.5l5 5-2.2 2.2-5-5z"/><path d="M12.3 6.7L4 15a1.6 1.6 0 0 0 0 2.3l.7.7a1.6 1.6 0 0 0 2.3 0l8.3-8.3"/><path d="M15.8 3.2l1.4-1.4 5 5-1.4 1.4"/>`),
  ant: svg(`<ellipse cx="12" cy="17.5" rx="3.2" ry="4"/><ellipse cx="12" cy="10.8" rx="1.8" ry="2.4"/><circle cx="12" cy="6" r="2.3"/><path d="M10.4 4.2L8 1.8M13.6 4.2L16 1.8M10.3 10l-4.3-2M13.7 10l4.3-2M10.3 11.4l-5 .8M13.7 11.4l5 .8M10.5 12.6l-3.8 3.6M13.5 12.6l3.8 3.6"/>`),
  dig: svg(`<path d="M4 20l7.5-7.5"/><path d="M9.5 6.5c3-3 7.5-3.5 10.5-1.5-1.5 1-2.6 2.2-3.4 3.6-1.3-.5-2.9-.4-4.1.6"/><path d="M12.5 9.2l2.3 2.3"/><path d="M14 15.5c1.5.3 3 1.4 3.5 3.5M17 13c1.3.6 2.4 1.8 2.6 3.6" opacity=".7"/>`),
  food: svg(`<path d="M12 3c4 4 6 7.4 6 10.3A6 6 0 0 1 6 13.3C6 10.4 8 7 12 3z"/><path d="M12 9.5c-1.6 1.6-2.4 3.2-2.4 4.6" opacity=".7"/>`),
  pop: svg(`<circle cx="8" cy="9" r="2.6"/><circle cx="16" cy="9" r="2.6"/><path d="M3.5 19c.6-3 2.4-4.6 4.5-4.6S11.9 16 12.5 19M11.5 19c.6-3 2.4-4.6 4.5-4.6s3.9 1.6 4.5 4.6"/>`),
  recall: svg(`<polygon points="${hexPts(12, 13.5, 6.5)}"/><path d="M20 4.5a9 9 0 0 0-14 1"/><path d="M5.2 2.5L6 5.6 9 4.8"/>`),
  attack: svg(`<path d="M5 19c1-6 4-10.5 9-13.5-1.2 3-1.6 5.6-1.2 8"/><path d="M19 19c-1-6-4-10.5-9-13.5 1.2 3 1.6 5.6 1.2 8"/><path d="M8 20l2-2M16 20l-2-2"/>`),
  defend: svg(`<path d="M12 3l7 2.8v5.4c0 4.4-3 7.7-7 9.3-4-1.6-7-4.9-7-9.3V5.8z"/><polygon points="${hexPts(12, 11.5, 3.3)}" opacity=".8"/>`),
  acid: svg(`<path d="M12 3c3.2 4.2 5 7.4 5 10a5 5 0 0 1-10 0c0-2.6 1.8-5.8 5-10z"/><path d="M9.8 14.2a2.4 2.4 0 0 0 2.2 2.3"/><path d="M5 6l1.2 1.2M19 6l-1.2 1.2M4 11h1.6M20 11h-1.6" opacity=".7"/>`),
  venom: svg(`<path d="M12 2.5v9"/><path d="M8.5 9.5L12 13l3.5-3.5"/><path d="M12 15.5c1.8 2.1 2.6 3.5 2.6 4.5a2.6 2.6 0 0 1-5.2 0c0-1 .8-2.4 2.6-4.5z"/>`),
  leaf: svg(`<path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14z"/><path d="M5 19L14 10"/><path d="M9 15l-1.5-3.5M12 12l-.5-3.6M11.8 15.2L15.3 15" opacity=".7"/>`),
  drop: svg(`<circle cx="9" cy="14" r="4"/><circle cx="16.5" cy="9" r="2.6"/><path d="M14 4.5c.8 1 1.2 1.8 1.2 2.4" opacity=".7"/>`),
  swap: svg(`<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>`),
  fast: svg(`<path d="M4 6l7 6-7 6z" fill="currentColor" fill-opacity=".25"/><path d="M12 6l7 6-7 6z" fill="currentColor" fill-opacity=".25"/>`),
  pause: svg(`<path d="M8 5v14M16 5v14" stroke-width="2.6"/>`),
  upgrade: svg(`<path d="M6 13l6-6 6 6M6 19l6-6 6 6"/>`),
  trash: svg(`<path d="M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13"/><path d="M10.5 10.5v6M13.5 10.5v6" opacity=".7"/>`),
  chevDown: svg(`<path d="M6 9l6 6 6-6"/>`),
  chevUp: svg(`<path d="M6 15l6-6 6 6"/>`),
  cancel: svg(`<circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/>`),
  trail: svg(`<path d="M3 16c3-6 5 2 8-4s5 2 10-6" stroke-dasharray="1.5 2.6"/><circle cx="3.5" cy="16" r="1.4" fill="currentColor"/><circle cx="20.5" cy="6" r="1.4" fill="currentColor"/>`),
  info: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".9" fill="currentColor"/>`),
  grid: svg(`<polygon points="${hexPts(8, 8.5, 4.2)}"/><polygon points="${hexPts(14.3, 12.1, 4.2)}"/><polygon points="${hexPts(8, 15.8, 4.2)}"/>`),
  help: svg(`<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.8v.6"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>`),
  eye: svg(`<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>`),
  menu: svg(`<path d="M4 7h16M4 12h16M4 17h16"/>`),
  close: svg(`<path d="M6 6l12 12M18 6L6 18"/>`),
  flag: svg(`<path d="M6 21V4"/><path d="M6 4h11l-2.5 4L17 12H6"/>`),
  queen: svg(`<path d="M4 17l2-9 4 4 2-6 2 6 4-4 2 9z"/><path d="M4 20h16"/>`),
  tiles: svg(`<polygon points="${hexPts(8, 9, 5.5)}"/><polygon points="${hexPts(16, 13.5, 5.5)}"/><path d="M6 8.5h4M15 12l2 0M15 15h2"/>`),
  cave: svg(`<path d="M2.5 19.5c0-7.5 4.3-12.5 9.5-12.5s9.5 5 9.5 12.5"/><path d="M7.5 19.5c0-3.8 2-6.5 4.5-6.5s4.5 2.7 4.5 6.5"/><path d="M2.5 19.5h19" opacity=".6"/>`),
  ally: svg(`<polygon points="${hexPts(8.5, 12, 6)}"/><polygon points="${hexPts(15.5, 12, 6)}"/>`),
  /** Saiy-Ants: the gold surge (a rising spark) */
  surge: svg(`<path d="M13 2.5L6.5 13.2h4.6L10 21.5l7.5-11.2h-4.8z" fill="currentColor" fill-opacity=".3"/><path d="M4 6l1.4.6M20 6l-1.4.6M3.5 17l1.5-.4M20.5 17l-1.5-.4" opacity=".7"/>`),
  /** hell ants: the upswung jaw against the horn */
  snap: svg(`<path d="M5 19c0-6 2.5-10 7-12.5"/><path d="M12 6.5c2.5-1.5 5-1.6 7.5-.5-2 .6-3.6 1.8-4.6 3.5"/><path d="M6.5 19.5C9 15 13 13 18.5 13c-1.3 2.4-3.6 4-6.5 4.6" fill="currentColor" fill-opacity=".25"/>`),
  /** termites: the drumming alarm (a head striking the ground, ripples) */
  drum: svg(`<ellipse cx="12" cy="9" rx="3.6" ry="4.4"/><path d="M12 13.4v3"/><path d="M6 19.5c1.6-1.6 3.8-2.5 6-2.5s4.4.9 6 2.5" opacity=".8"/><path d="M3 21.5c2.4-2 5.6-3.2 9-3.2s6.6 1.2 9 3.2" opacity=".5"/>`),
  /** Termants: the genome (a short twisted double strand with rungs) */
  gene: svg(`<path d="M8 2.5c0 5 8 6 8 9.5s-8 4.5-8 9.5"/><path d="M16 2.5c0 5-8 6-8 9.5s8 4.5 8 9.5"/><path d="M9.2 5.5h5.6M10.6 8.6h2.8M10.6 15.4h2.8M9.2 18.5h5.6" opacity=".75"/>`),
  /** Termants: stored wood (a cut log with rings) */
  wood: svg(`<path d="M5 8.5h11.5a3.5 3.5 0 0 1 0 7H5"/><ellipse cx="5" cy="12" rx="2.2" ry="3.5"/><ellipse cx="5" cy="12" rx=".8" ry="1.3" opacity=".7"/><path d="M9 10.5h5M11 13.6h4" opacity=".6"/>`),
  /** climbing a creature: a slope and an arrow up (marker order: no climbing) */
  climb: svg(`<path d="M3 20l6.5-8 3.5 4 3-3.5 5 7.5z"/><path d="M15 9.5V3M12.3 5.7L15 3l2.7 2.7"/>`),
  /** folded map (touch: show/hide the minimaps) */
  map: svg(`<path d="M3 6.5l5.5-2.5 7 2.5 5.5-2.5v13.5l-5.5 2.5-7-2.5L3 20z"/><path d="M8.5 4v13.5M15.5 6.5V20" opacity=".7"/>`),
  layers: svg(`<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5" opacity=".7"/>`),
};

export type IconName = keyof typeof ICONS;

/** Ability icon per species. */
export function abilityIcon(species: string): string {
  switch (species) {
    case 'formica':
      return ICONS.acid;
    case 'solenopsis':
      return ICONS.venom;
    case 'atta':
      return ICONS.leaf;
    case 'lasius':
      return ICONS.drop;
    case 'nasutitermes':
    case 'rhynchotermes':
    case 'termant':
      return ICONS.drum;
    case 'hell':
      return ICONS.snap;
    case 'aurimyrmex':
      return ICONS.surge;
    default:
      return ICONS.swap;
  }
}

/**
 * Top-down ant silhouette for caste cards (heading up). Role sets the
 * proportions: minims tiny-headed, soldiers/majors big-headed with long
 * mandibles, queens with a long gaster and mesosoma.
 */
export function antSilhouette(role: string, color: string, head = 1): string {
  const big = role === 'soldier' || role === 'major';
  const queen = role === 'queen';
  const hr = (big ? 5.2 : role === 'minim' ? 2.8 : 3.4) * head;
  const gy = queen ? 29 : 28;
  const gr = queen ? [5.6, 8.2] : [5, 6.5];
  const mes = queen ? [3.4, 5.6] : [2.6, 4.4];
  const hy = 11 - (big ? 1.2 : 0);
  const mand = big ? `<path d="M${20 - 2.2} ${hy - hr + 0.8}q-2 -4 1.2 -6.2M${20 + 2.2} ${hy - hr + 0.8}q2 -4 -1.2 -6.2" stroke="${color}" stroke-width="1.5" fill="none"/>` : `<path d="M${20 - 1.4} ${hy - hr + 0.6}l.6 -2M${20 + 1.4} ${hy - hr + 0.6}l-.6 -2" stroke="${color}" stroke-width="1.2"/>`;
  const legs = [
    [17.6, 17, 9, 13],
    [22.4, 17, 31, 13],
    [17.4, 19, 8, 21],
    [22.6, 19, 32, 21],
    [17.8, 21, 10, 29],
    [22.2, 21, 30, 29],
  ]
    .map(([x1, y1, x2, y2]) => `<path d="M${x1} ${y1}L${(x1 + x2) / 2} ${(y1 + y2) / 2 - 2}L${x2} ${y2}"/>`)
    .join('');
  return `<svg viewBox="0 0 40 40" class="ant-sil" aria-hidden="true">
    <g stroke="${color}" stroke-width="1.1" fill="none" stroke-linecap="round" stroke-linejoin="round">${legs}
      <path d="M${20 - hr * 0.5} ${hy - hr * 0.7}q-3 -3 -6 -4M${20 + hr * 0.5} ${hy - hr * 0.7}q3 -3 6 -4"/></g>
    ${mand}
    <ellipse cx="20" cy="${gy}" rx="${gr[0]}" ry="${gr[1]}" fill="${color}"/>
    <circle cx="20" cy="${gy - gr[1] - 1.2}" r="1.3" fill="${color}"/>
    <ellipse cx="20" cy="19" rx="${mes[0]}" ry="${mes[1]}" fill="${color}"/>
    <ellipse cx="20" cy="${hy}" rx="${hr}" ry="${hr * (big ? 0.95 : 1.05)}" fill="${color}"/>
    <ellipse cx="${20 - hr * 0.55}" cy="${hy - hr * 0.1}" rx=".9" ry="1.2" fill="#000" opacity=".55"/>
    <ellipse cx="${20 + hr * 0.55}" cy="${hy - hr * 0.1}" rx=".9" ry="1.2" fill="#000" opacity=".55"/>
  </svg>`;
}
