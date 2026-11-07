import { audio } from '../audio/engine';
import { SOUNDS } from '../audio/catalog';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The Credits screen's content: sound credits from the audio manifest (ATTRIBUTIONS.md), libraries and fonts. */
export function creditsHtml(): string {
  const credits = audio.bank.manifest.credits;
  const sound = credits.length
    ? `<ul class="credits-list">${credits
        .map((c) => `<li><b>${esc(c.title || c.file)}</b> by ${esc(c.author || 'unknown')}${c.license ? ` · ${esc(c.license)}` : ''}${c.url && /^https?:/.test(c.url) ? ` · <a href="${esc(c.url)}" target="_blank" rel="noopener">source</a>` : ''}</li>`)
        .join('')}</ul>`
    : '';
  return `
    <h3>Underground Dominion</h3>
    <p>An ant colony strategy game rooted in real biology.</p>
    <h3>Sound</h3>
    ${sound}
    <p>${credits.length ? 'The recordings credited above are used under their licences. ' : ''}Every other sound was made for this game, rendered from the physics of the real thing (chitin clicks and fractures, stridulation, grains of soil and leaf, tiny bubbles); the music is played live by the game on modelled acoustic instruments. ${SOUNDS.length} sounds, no third-party audio unless credited.</p>
    <h3>Software</h3>
    <p>three.js (MIT licence) · PeerJS (MIT licence) · Vite (MIT licence)</p>
    <h3>Fonts</h3>
    <p>Marcellus SC and Alegreya Sans (SIL Open Font Licence), via Google Fonts</p>`;
}
