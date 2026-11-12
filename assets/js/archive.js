import { initVideos } from './site.js';

initVideos();

// Filter entries by kind; era headings hide when they have nothing to show.
const buttons = [...document.querySelectorAll('[data-filter]')];
const entries = [...document.querySelectorAll('.entry')];
const eras = [...document.querySelectorAll('.era')];
buttons.forEach((b) => b.addEventListener('click', () => {
  const f = b.dataset.filter;
  buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  entries.forEach((e) => { e.hidden = f !== 'all' && e.dataset.kind !== f; });
  eras.forEach((h) => {
    let el = h.nextElementSibling, any = false;
    while (el && !el.classList.contains('era')) { if (!el.hidden) any = true; el = el.nextElementSibling; }
    h.hidden = !any;
  });
}));

// Highlight the year currently on screen.
const links = new Map([...document.querySelectorAll('.year-rail a')].map((a) => [a.getAttribute('href').slice(1), a]));
const anchors = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean);
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((list) => {
    for (const e of list) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.classList.remove('active'));
      links.get(e.target.id)?.classList.add('active');
    }
  }, { rootMargin: '-30% 0px -60% 0px' });
  anchors.forEach((a) => io.observe(a));
}
