// Shared behaviors for jackychen.xyz. No dependencies.

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Fade sections in as they enter the viewport. Content is visible without JS.
export function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || reducedMotion()) {
    els.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  els.forEach((el) => io.observe(el));
}

// Click a [data-full] button to view the larger photo in a <dialog>.
export function initLightbox() {
  const dlg = document.querySelector('[data-lightbox]');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  const img = dlg.querySelector('img');
  const cap = dlg.querySelector('[data-caption]');
  document.addEventListener('click', (ev) => {
    const trigger = ev.target.closest('[data-full]');
    if (!trigger) return;
    const thumb = trigger.querySelector('img');
    img.src = trigger.dataset.full;
    img.alt = thumb ? thumb.alt : '';
    cap.textContent = thumb ? thumb.alt : '';
    dlg.showModal();
  });
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg || ev.target.closest('[data-close]')) dlg.close();
  });
}

// YouTube "facade": only load the player (and its cookies) after a click.
export function initVideos() {
  document.querySelectorAll('[data-video]').forEach((box) => {
    const btn = box.querySelector('button');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const f = document.createElement('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(box.dataset.video)}?autoplay=1&rel=0`;
      f.title = box.dataset.title || 'Video';
      f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      box.replaceChildren(f);
      f.focus();
    });
  });
}
