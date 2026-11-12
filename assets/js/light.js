// "Hold the heart": a browser re-creation of a touch-reactive LED heart.
// ~300 addressable LEDs on one strip wound into concentric heart outlines.
//   idle      rainbow twinkle
//   charging  warm light climbs from the tip of the heart while you hold
//   full      red heartbeat once fully charged
//   draining  charge falls back down after release
// Touch is debounced like the hardware: press must be stable for PRESS_MS,
// release for RELEASE_MS, before the state changes.

import { reducedMotion } from './site.js';

const N = 300;
const RING_SCALES = [1, 0.78, 0.56, 0.34];
const RING_COUNTS = (() => {
  const total = RING_SCALES.reduce((a, b) => a + b, 0);
  const c = RING_SCALES.map((s) => Math.round((N * s) / total));
  c[0] += N - c.reduce((a, b) => a + b, 0);
  return c;
})();
const Y_MIN = -17, Y_MAX = 12.2, Y_MID = (Y_MIN + Y_MAX) / 2;
const RING_CY = -6; // inner rings shrink toward this point so gaps at the dip and the tip match
const heartPt = (t) => [
  16 * Math.sin(t) ** 3,
  13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t),
];
// Arc-length table so LEDs sit evenly along the curve, starting at the tip (t = π).
const SAMPLES = 2400;
const ARC = (() => {
  const pts = [], cum = [0];
  for (let k = 0; k <= SAMPLES; k++) pts.push(heartPt(Math.PI + (k / SAMPLES) * Math.PI * 2));
  for (let k = 1; k <= SAMPLES; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return { pts, cum };
})();
const HEART_LEN = ARC.cum[SAMPLES];
function pointAt(s) {
  let lo = 0, hi = SAMPLES;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ARC.cum[mid] < s) lo = mid + 1; else hi = mid; }
  return ARC.pts[lo];
}
function buildHeart() {
  const out = [];
  RING_SCALES.forEach((scale, ring) => {
    const n = RING_COUNTS[ring];
    for (let j = 0; j < n; j++) {
      const k = ring % 2 === 0 ? j : n - 1 - j;           // serpentine: alternate direction per ring
      const [x, y] = pointAt(((k + 0.5) / n) * HEART_LEN);
      const ux = x * scale, uy = RING_CY + (y - RING_CY) * scale;
      out.push({ ux, uy, h: (uy - Y_MIN) / (Y_MAX - Y_MIN), x: 0, y: 0, spark: 0 });
    }
  });
  return out;
}
const PRESS_MS = 60;
const RELEASE_MS = 140;
const CHARGE_S = 2.6;
const DRAIN_S = 1.5;
const BEAT_S = 0.92; // ~65 bpm

const STATE_LABEL = { idle: 'Idle', charging: 'Charging', full: 'Heartbeat', draining: 'Draining' };

export function initLight(section) {
  const stage = section.querySelector('[data-light]');
  const canvas = stage?.querySelector('canvas');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const stateEl = section.querySelector('[data-light-state]');
  const chargeEl = section.querySelector('[data-light-charge]');
  const stateItems = [...section.querySelectorAll('[data-light-states] [data-state]')];
  const holdBtn = section.querySelector('[data-light-hold]');
  const calm = reducedMotion();

  // LED model: one strip wound into concentric heart outlines, each starting at the tip.
  // ux/uy are heart-curve units; h is height from the tip (0) to the top of the lobes (1).
  const leds = buildHeart();
  const outerSpacing = HEART_LEN / RING_COUNTS[0];

  let w = 0, hgt = 0, r = 2, dpr = 1;
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = stage.getBoundingClientRect();
    w = Math.max(1, Math.round(rect.width * dpr));
    hgt = Math.max(1, Math.round(rect.height * dpr));
    canvas.width = w; canvas.height = hgt;
    const unit = Math.min((w * 0.82) / 32, (hgt * 0.7) / (Y_MAX - Y_MIN));
    const cx = w / 2, cy = hgt * 0.47;
    for (const led of leds) {
      led.x = cx + led.ux * unit;
      led.y = cy - (led.uy - Y_MID) * unit;
    }
    r = Math.max(1.6 * dpr, outerSpacing * unit * 0.3);
  }

  // ---- input with debounce ----------------------------------------------------
  let raw = false, rawChanged = 0, touch = false;
  const setRaw = (v) => {
    if (raw === v) return;
    raw = v; rawChanged = performance.now();
    if (v) stage.classList.add('touched');
    holdBtn?.classList.toggle('pressed', v);
    wake();
  };
  stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture?.(e.pointerId); setRaw(true); });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(t, () => setRaw(false));
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  if (holdBtn) {
    holdBtn.addEventListener('pointerdown', (e) => { holdBtn.setPointerCapture?.(e.pointerId); setRaw(true); });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) holdBtn.addEventListener(t, () => setRaw(false));
    holdBtn.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); setRaw(true); }
    });
    holdBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setRaw(false); } });
    holdBtn.addEventListener('blur', () => setRaw(false));
    holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---- state machine ------------------------------------------------------------
  let phase = 'idle', charge = 0, idleMix = 1, beatT = 0, t = 0, last = 0;
  function step(dt, now) {
    const since = now - rawChanged;
    if (raw && !touch && since >= PRESS_MS) touch = true;
    if (!raw && touch && since >= RELEASE_MS) touch = false;

    if (touch) {
      charge = Math.min(1, charge + dt / CHARGE_S);
      if (charge >= 1) { if (phase !== 'full') beatT = 0; phase = 'full'; } else phase = 'charging';
    } else if (charge > 0) {
      charge = Math.max(0, charge - dt / DRAIN_S);
      phase = charge > 0 ? 'draining' : 'idle';
    } else phase = 'idle';

    const idleTarget = phase === 'idle' ? 1 : 0.12;
    idleMix += (idleTarget - idleMix) * Math.min(1, dt * (phase === 'idle' ? 1.6 : 6));
    beatT += dt;
    t += dt;
  }

  // Heartbeat envelope: "lub" then a softer "dub".
  function heartbeat(x) {
    const p = (x % BEAT_S) / BEAT_S;
    const bump = (c, wdt) => Math.exp(-((p - c) ** 2) / (2 * wdt * wdt));
    if (calm) return 0.55 + 0.45 * Math.sin(p * Math.PI * 2) ** 2;
    return Math.min(1, bump(0.06, 0.035) + 0.7 * bump(0.26, 0.04));
  }

  function draw() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, hgt);
    ctx.globalCompositeOperation = 'lighter';
    const ease = charge * charge * (3 - 2 * charge);
    const pulse = phase === 'full' ? heartbeat(beatT) : 0;
    for (let i = 0; i < N; i++) {
      const led = leds[i];
      // idle rainbow, drifting along the strip, with random sparkles
      if (!calm && Math.random() < 0.004) led.spark = 1;
      led.spark *= 0.94;
      const hue = ((calm ? 0 : t * 36) + i * 2.4) % 360;
      let R, G, B, a;
      const idleA = (0.28 + (calm ? 0.25 : led.spark * 0.72)) * idleMix;
      [R, G, B] = hsl(hue, 0.9, 0.58);
      a = idleA;

      if (phase === 'full') {
        const ripple = calm ? 1 : 0.75 + 0.25 * Math.sin((led.h * 6 - beatT * 7));
        const v = 0.18 + 0.82 * pulse * ripple;
        [R, G, B] = mix([R, G, B], [227, 25, 43], 1 - idleMix * 0.2);
        a = Math.max(a, v);
      } else if (charge > 0 && led.h <= ease + 0.002) {
        const depth = ease - led.h;                     // 0 at the leading edge
        const edge = Math.max(0, 1 - depth / 0.06);     // hot leading edge
        const warm = mix([196, 46, 10], [255, 150, 40], Math.min(1, led.h / Math.max(ease, 0.01)));
        [R, G, B] = mix(warm, [255, 236, 200], edge * 0.7);
        a = Math.max(a, 0.55 + 0.45 * edge);
        if (phase === 'draining') a *= 0.85;
      }

      // glow + core
      ctx.fillStyle = `rgba(${R | 0},${G | 0},${B | 0},${(a * 0.2).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(led.x, led.y, r * 4.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(${R | 0},${G | 0},${B | 0},${Math.min(1, a).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(led.x, led.y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  let lastLabel = '';
  function hud() {
    const label = STATE_LABEL[phase];
    if (label !== lastLabel) {
      lastLabel = label;
      if (stateEl) stateEl.textContent = label;
      stateItems.forEach((li) => li.classList.toggle('active', li.dataset.state === phase));
    }
    if (chargeEl) chargeEl.textContent = `Charge ${Math.round(charge * 100)}%`;
  }

  // ---- loop: only runs while visible -------------------------------------------------
  let running = false, visible = false, raf = 0;
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    step(dt, now);
    draw();
    hud();
    raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (running || !visible || document.hidden) return;
    running = true; last = 0; raf = requestAnimationFrame(frame);
  }
  function sleep() { running = false; cancelAnimationFrame(raf); }

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? wake() : sleep(); }, { threshold: 0.05 }).observe(stage);
  document.addEventListener('visibilitychange', () => (document.hidden ? sleep() : wake()));
  new ResizeObserver(() => { layout(); draw(); }).observe(stage);
  layout(); draw(); hud();
}

function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
function mix(a, b, m) {
  return [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m];
}
