// /events/: the page is built ahead of time, so re-sort cards by the visitor's clock.
// An event moves to the archive once it ends, without anyone rebuilding the site.
const upcoming = document.querySelector('[data-upcoming]');
const past = document.querySelector('[data-past]');
if (upcoming && past) {
  const now = Date.now();
  const cards = [...document.querySelectorAll('.ev-card')];
  const isPast = (c) => Date.parse(c.dataset.end) <= now;
  const byStart = (a, b) => Date.parse(a.dataset.start) - Date.parse(b.dataset.start);
  const next = cards.filter((c) => !isPast(c)).sort(byStart);
  const done = cards.filter(isPast).sort(byStart).reverse();
  for (const c of cards) c.classList.toggle('is-past', isPast(c));
  upcoming.replaceChildren(...next);
  past.replaceChildren(...done);
  document.querySelector('[data-upcoming-empty]').hidden = next.length > 0;
  document.querySelector('[data-past-empty]').hidden = done.length > 0;
}
