import { initReveal, initLightbox, initVideos, initTimecode } from './site.js';
import { initLight } from './light.js';
import { generateDaily, todayISO } from './sudoku/engine.mjs';

initReveal();
initLightbox();
initVideos();
initTimecode();

const light = document.querySelector('#light');
if (light) initLight(light);

// Mini preview of today's medium puzzle.
const mini = document.querySelector('[data-mini-sudoku]');
if (mini) {
  const today = todayISO();
  const { puzzle, clues } = generateDaily(today, 'medium');
  const frag = document.createDocumentFragment();
  for (const ch of puzzle) {
    const s = document.createElement('span');
    s.textContent = ch === '0' ? '' : ch;
    frag.append(s);
  }
  mini.replaceChildren(frag);
  const cap = document.querySelector('[data-mini-caption]');
  const [y, m, d] = today.split('-').map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  if (cap) cap.textContent = `${label} · Medium · ${clues} clues. A new grid every day, the same one for everyone.`;
}
