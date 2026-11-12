// Daily Sudoku UI. Puzzle generation lives in engine.mjs (tested in _dev/tests).
import { generateDaily, findConflicts, PEERS, DIFFICULTIES, todayISO, addDays, isISODate } from './engine.mjs';

const $ = (s, el = document) => el.querySelector(s);
const board = $('[data-board]');
const pad = $('[data-pad]');
const panel = $('.panel');
const statusEl = $('[data-status]');
const timeEl = $('[data-time]');
const pausedEl = $('[data-paused]');
const doneEl = $('[data-done]');
const notesBtn = $('[data-notes]');
const levelBtns = [...document.querySelectorAll('[data-level]')];
const prevLink = $('[data-prev]');
const nextLink = $('[data-next]');
const todayLink = $('[data-today]');
const resetBtn = $('[data-reset]');

// ---- storage (best effort; private windows may block it) --------------------------
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const STATS_KEY = 'jc-sudoku:stats:v1';
const LEVEL_KEY = 'jc-sudoku:level';

// ---- initial date / level from URL ------------------------------------------------------
const today = todayISO();
const params = new URLSearchParams(location.search);
const qDate = params.get('date');
let date = isISODate(qDate) && qDate <= today ? qDate : today;
let level = params.get('level');
if (!DIFFICULTIES[level]) level = store.get(LEVEL_KEY);
if (!DIFFICULTIES[level]) level = 'medium';

let game = null;
let selected = -1;
let notesMode = false;
let paused = false;
let lastTick = 0;
let timerId = 0;
let lastSavedSecond = -1;

const gameKey = () => `jc-sudoku:${date}:${level}`;
const fmt = (ms) => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
const dateObj = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const longDate = (iso) => dateObj(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const shortDate = (iso) => dateObj(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

// ---- build static DOM -----------------------------------------------------------------------
const cells = [];
for (let i = 0; i < 81; i++) {
  const r = (i / 9) | 0, c = i % 9;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `cell${c === 3 || c === 6 ? ` c${c}` : ''}${r === 3 || r === 6 ? ` r${r}` : ''}`;
  b.style.setProperty('--r', r);
  b.style.setProperty('--c', c);
  b.addEventListener('click', () => select(i, true));
  cells.push(b);
  board.append(b);
}
const padBtns = [];
for (let d = 1; d <= 9; d++) {
  const b = document.createElement('button');
  b.type = 'button';
  b.innerHTML = `${d}<small></small>`;
  b.setAttribute('aria-label', `Enter ${d}`);
  b.addEventListener('click', () => input(d));
  padBtns.push(b);
  pad.append(b);
}

// ---- game lifecycle ---------------------------------------------------------------------------
function load() {
  const p = generateDaily(date, level);
  const values = [...p.puzzle].map(Number);
  let notes = Array(81).fill(0), elapsed = 0, done = false;
  const saved = store.get(gameKey());
  if (saved && typeof saved.v === 'string' && saved.v.length === 81) {
    for (let i = 0; i < 81; i++) if (p.puzzle[i] === '0') values[i] = Number(saved.v[i]) || 0;
    if (Array.isArray(saved.n) && saved.n.length === 81) notes = saved.n.map((x) => x | 0);
    elapsed = Number(saved.t) || 0;
    done = !!saved.done && values.join('') === p.solution;
  }
  game = { ...p, values, notes, elapsed, done, history: [] };
  selected = values.findIndex((v) => !v);
  if (selected < 0) selected = 0;
  paused = false;
  pausedEl.hidden = true;
  board.classList.remove('won');
  doneEl.hidden = !done;
  setStatus(done ? `Solved in ${fmt(elapsed)}.` : '', done ? 'good' : '');
  syncUrl();
  updateHeader();
  updateStats();
  render();
  startTimer();
}

function save() {
  if (!game) return;
  store.set(gameKey(), { v: game.values.join(''), n: game.notes, t: Math.round(game.elapsed), done: game.done });
}

function syncUrl() {
  const q = new URLSearchParams();
  if (date !== today) q.set('date', date);
  q.set('level', level);
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

// ---- rendering ------------------------------------------------------------------------------------
function render() {
  const conflicts = findConflicts(game.values);
  const selVal = selected >= 0 ? game.values[selected] : 0;
  const peers = new Set(selected >= 0 ? PEERS[selected] : []);
  const counts = Array(10).fill(0);
  for (const v of game.values) counts[v]++;

  cells.forEach((btn, i) => {
    const v = game.values[i];
    const given = game.puzzle[i] !== '0';
    const notes = game.notes[i];
    btn.classList.toggle('given', given);
    btn.classList.toggle('selected', i === selected);
    btn.classList.toggle('peer', peers.has(i));
    btn.classList.toggle('same', !!v && v === selVal && i !== selected);
    btn.classList.toggle('conflict', !!v && conflicts.has(i));
    btn.tabIndex = i === selected ? 0 : -1;
    if (v) {
      btn.textContent = v;
    } else if (notes) {
      let html = '<span class="notes" aria-hidden="true">';
      for (let d = 1; d <= 9; d++) html += `<span class="${d === selVal ? 'hit' : ''}">${notes & (1 << d) ? d : ''}</span>`;
      btn.innerHTML = `${html}</span>`;
    } else {
      btn.textContent = '';
    }
    const r = ((i / 9) | 0) + 1, c = (i % 9) + 1;
    const noteList = [];
    for (let d = 1; d <= 9; d++) if (notes & (1 << d)) noteList.push(d);
    btn.setAttribute('aria-label',
      `Row ${r}, column ${c}: ${v ? `${given ? 'given ' : ''}${v}` : 'empty'}${!v && noteList.length ? `, notes ${noteList.join(' ')}` : ''}${conflicts.has(i) ? ', conflict' : ''}`);
  });

  padBtns.forEach((b, k) => {
    const d = k + 1, left = 9 - counts[d];
    b.querySelector('small').textContent = left > 0 ? left : '';
    b.classList.toggle('complete', left <= 0);
  });
  notesBtn.setAttribute('aria-pressed', String(notesMode));
  panel.classList.toggle('notes-on', notesMode);
}

function updateHeader() {
  $('[data-date-label]').textContent = date === today ? `Today, ${dateObj(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : longDate(date);
  document.title = `Daily Sudoku · ${shortDate(date)} · Jacky Chen`;
  const solved = (store.get(STATS_KEY) || {})[date] || {};
  levelBtns.forEach((b) => {
    const l = b.dataset.level;
    b.setAttribute('aria-pressed', String(l === level));
    b.innerHTML = `${DIFFICULTIES[l].label}${solved[l] ? '<span class="tick" aria-label="(solved)">✓</span>' : ''}`;
  });
  const prev = addDays(date, -1), next = addDays(date, 1);
  prevLink.href = `?date=${prev}&level=${level}`;
  nextLink.href = next <= today ? `?date=${next}&level=${level}` : '#';
  nextLink.setAttribute('aria-disabled', String(next > today));
  todayLink.hidden = date === today;
}

function updateStats() {
  const stats = store.get(STATS_KEY) || {};
  let streak = 0;
  let day = stats[today] ? today : addDays(today, -1);
  while (stats[day] && Object.keys(stats[day]).length) { streak++; day = addDays(day, -1); }
  $('[data-streak]').textContent = `${streak} ${streak === 1 ? 'day' : 'days'}`;
  let best = Infinity;
  for (const d of Object.keys(stats)) if (stats[d][level]) best = Math.min(best, stats[d][level]);
  $('[data-best]').textContent = Number.isFinite(best) ? fmt(best) : '—';
  $('[data-clues]').textContent = game ? String(game.clues) : '—';
}

function setStatus(text, tone = '') {
  statusEl.textContent = text;
  statusEl.className = `status${tone ? ` ${tone}` : ''}`;
}

// ---- input --------------------------------------------------------------------------------------------
function select(i, focus = false) {
  selected = i;
  render();
  if (focus) cells[i].focus({ preventScroll: true });
}

function input(d, asNote = false) {
  if (!game || game.done || paused || selected < 0) return;
  const i = selected;
  if (game.puzzle[i] !== '0') { setStatus('That one’s a given.'); return; }
  const snap = { i, v: game.values[i], n: game.notes[i], cleared: null, d };
  if (notesMode || asNote) {
    if (game.values[i]) return;
    game.notes[i] ^= 1 << d;
  } else if (game.values[i] === d) {
    game.values[i] = 0;
  } else {
    game.values[i] = d;
    game.notes[i] = 0;
    const cleared = [];
    for (const p of PEERS[i]) if (game.notes[p] & (1 << d)) { cleared.push(p); game.notes[p] &= ~(1 << d); }
    snap.cleared = cleared;
  }
  game.history.push(snap);
  afterChange();
}

function erase() {
  if (!game || game.done || paused || selected < 0) return;
  const i = selected;
  if (game.puzzle[i] !== '0' || (!game.values[i] && !game.notes[i])) return;
  game.history.push({ i, v: game.values[i], n: game.notes[i], cleared: null });
  game.values[i] = 0;
  game.notes[i] = 0;
  afterChange();
}

function undo() {
  if (!game || game.done || paused) return;
  const s = game.history.pop();
  if (!s) { setStatus('Nothing to undo.'); return; }
  game.values[s.i] = s.v;
  game.notes[s.i] = s.n;
  if (s.cleared) for (const p of s.cleared) game.notes[p] |= 1 << s.d;
  selected = s.i;
  afterChange();
}

function afterChange() {
  save();
  render();
  if (game.values.every((v) => v)) {
    if (game.values.join('') === game.solution) win();
    else setStatus('Every cell is full, but something’s off. Look for the red cells.');
  } else if (statusEl.textContent) setStatus('');
}

function win() {
  game.done = true;
  stopTimer();
  save();
  const stats = store.get(STATS_KEY) || {};
  stats[date] = stats[date] || {};
  const t = Math.round(game.elapsed);
  stats[date][level] = stats[date][level] ? Math.min(stats[date][level], t) : t;
  store.set(STATS_KEY, stats);
  const sr = (selected / 9) | 0, sc = selected % 9;
  cells.forEach((b, i) => b.style.setProperty('--d', Math.abs(((i / 9) | 0) - sr) + Math.abs((i % 9) - sc)));
  board.classList.remove('won');
  void board.offsetWidth;
  board.classList.add('won');
  doneEl.hidden = false;
  setStatus(`Solved in ${fmt(game.elapsed)}. Nicely done.`, 'good');
  updateHeader();
  updateStats();
  render();
}

// ---- timer ----------------------------------------------------------------------------------------------
function showTime() { timeEl.textContent = fmt(game.elapsed); }
function startTimer() {
  stopTimer();
  showTime();
  if (game.done) return;
  lastTick = performance.now();
  timerId = setInterval(() => {
    const now = performance.now();
    if (!paused && !document.hidden && !game.done) game.elapsed += now - lastTick;
    lastTick = now;
    showTime();
    const sec = Math.floor(game.elapsed / 1000);
    if (sec % 5 === 0 && sec !== lastSavedSecond) { lastSavedSecond = sec; save(); }
  }, 250);
}
function stopTimer() { clearInterval(timerId); timerId = 0; }
function setPaused(v) {
  if (game.done) return;
  paused = v;
  pausedEl.hidden = !v;
  if (v) { save(); $('[data-resume]').focus(); } else cells[selected]?.focus({ preventScroll: true });
}

// ---- wiring -------------------------------------------------------------------------------------------------
notesBtn.addEventListener('click', () => { notesMode = !notesMode; render(); });
$('[data-erase]').addEventListener('click', erase);
$('[data-undo]').addEventListener('click', undo);
$('[data-pause]').addEventListener('click', () => setPaused(true));
$('[data-resume]').addEventListener('click', () => setPaused(false));
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('pagehide', save);

levelBtns.forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.level === level) return;
  save();
  level = b.dataset.level;
  store.set(LEVEL_KEY, level);
  load();
}));

function goTo(iso) {
  if (iso > today) return;
  save();
  date = iso;
  load();
}
prevLink.addEventListener('click', (e) => { e.preventDefault(); goTo(addDays(date, -1)); });
nextLink.addEventListener('click', (e) => { e.preventDefault(); goTo(addDays(date, 1)); });
todayLink.addEventListener('click', (e) => { e.preventDefault(); goTo(today); });

let resetArmed = 0;
resetBtn.addEventListener('click', () => {
  if (!resetArmed) {
    resetBtn.textContent = 'Tap again to reset (this clears your progress)';
    resetArmed = setTimeout(() => { resetArmed = 0; resetBtn.textContent = 'Reset this puzzle'; }, 3500);
    return;
  }
  clearTimeout(resetArmed); resetArmed = 0;
  resetBtn.textContent = 'Reset this puzzle';
  store.del(gameKey());
  load();
});

$('[data-share]').addEventListener('click', async () => {
  const text = `Jacky’s Daily Sudoku · ${shortDate(date)} · ${DIFFICULTIES[level].label} · ${fmt(game.elapsed)}\n${location.origin}/sudoku/?date=${date}&level=${level}`;
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Copied your result to the clipboard.', 'good');
  } catch {
    if (navigator.share) { try { await navigator.share({ text }); } catch { /* cancelled */ } }
    else setStatus(text);
  }
});

document.addEventListener('keydown', (e) => {
  if (!game || e.altKey) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.metaKey || e.ctrlKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const m = /^(Digit|Numpad)([0-9])$/.exec(e.code);
  if (m) {
    const d = Number(m[2]);
    e.preventDefault();
    if (d === 0) erase(); else input(d, e.shiftKey);
    return;
  }
  const inBoard = board.contains(document.activeElement);
  const k = e.key;
  if (k === 'Backspace' || k === 'Delete') { if (inBoard || !t || t === document.body) { e.preventDefault(); erase(); } return; }
  if (k === 'n' || k === 'N') { notesMode = !notesMode; render(); return; }
  if (k === 'u' || k === 'U') { undo(); return; }
  if (k === 'p' || k === 'P') { setPaused(!paused); return; }
  if (inBoard && k.startsWith('Arrow')) {
    e.preventDefault();
    let r = (selected / 9) | 0, c = selected % 9;
    if (k === 'ArrowUp') r = (r + 8) % 9;
    if (k === 'ArrowDown') r = (r + 1) % 9;
    if (k === 'ArrowLeft') c = (c + 8) % 9;
    if (k === 'ArrowRight') c = (c + 1) % 9;
    select(r * 9 + c, true);
  }
});

load();
