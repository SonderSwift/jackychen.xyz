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

// A camera-style timecode that advances as you scroll (100px ≈ 1 second at 24 fps)
// and names the current "scene". Purely decorative (aria-hidden).
export function initTimecode() {
  const el = document.querySelector('.timecode');
  if (!el) return;
  const tc = el.querySelector('[data-timecode]');
  const sc = el.querySelector('[data-scene]');
  const scenes = [...document.querySelectorAll('[data-scene-label]')];
  const pad = (n) => String(n).padStart(2, '0');
  let queued = false;
  const update = () => {
    queued = false;
    const frames = Math.floor((window.scrollY / 100) * 24);
    const f = frames % 24, s = Math.floor(frames / 24) % 60, m = Math.floor(frames / 1440) % 60, h = Math.floor(frames / 86400);
    tc.textContent = `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
    const line = window.innerHeight * 0.85;
    let current = scenes[0];
    for (const s2 of scenes) if (s2.getBoundingClientRect().top <= line) current = s2;
    if (current) {
      sc.textContent = current.dataset.sceneLabel;
      const r = current.getBoundingClientRect();
      const night = current.hasAttribute('data-night') && r.bottom > window.innerHeight - 40;
      el.classList.toggle('on-night', night);
    }
  };
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}
