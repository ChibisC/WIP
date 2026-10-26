import { audio } from '../audio/engine';
import { SOUNDS } from '../audio/catalog';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The Credits screen's content: sound credits from the audio manifest (ATTRIBUTIONS.md), libraries and fonts. */
export function creditsHtml(): string {
  const credits = audio.bank.manifest.credits;
  const recorded = SOUNDS.filter((s) => audio.bank.files(s).length).length;
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
    <p>${recorded ? `${recorded} of ${SOUNDS.length} sounds use the recordings credited above. ` : ''}Every other sound is synthesised in the game from the physics of the real thing (grains of soil and leaf, chitin and wood resonances, water bubbles, stridulation), with no third-party audio.</p>
    <h3>Software</h3>
    <p>three.js (MIT licence) · PeerJS (MIT licence) · Vite (MIT licence)</p>
    <h3>Fonts</h3>
    <p>Marcellus SC and Alegreya Sans (SIL Open Font Licence), via Google Fonts</p>`;
}
