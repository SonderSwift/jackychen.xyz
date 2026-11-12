// Daily Sudoku engine: deterministic, dependency-free, runs in the browser and in Node.
// A puzzle is a pure function of (date, difficulty), so everyone gets the same grid each day.

export const DIFFICULTIES = {
  easy:   { label: 'Easy',   target: 38, singlesOnly: true,  needsMore: false },
  medium: { label: 'Medium', target: 30, singlesOnly: true,  needsMore: false },
  hard:   { label: 'Hard',   target: 22, singlesOnly: false, needsMore: true  },
};

const ROW = new Uint8Array(81), COL = new Uint8Array(81), BOX = new Uint8Array(81);
for (let i = 0; i < 81; i++) {
  ROW[i] = (i / 9) | 0;
  COL[i] = i % 9;
  BOX[i] = ((ROW[i] / 3) | 0) * 3 + ((COL[i] / 3) | 0);
}
export const UNITS = [];
for (let u = 0; u < 9; u++) {
  UNITS.push([...Array(9)].map((_, k) => u * 9 + k));                                   // rows
  UNITS.push([...Array(9)].map((_, k) => k * 9 + u));                                   // cols
  const r0 = ((u / 3) | 0) * 3, c0 = (u % 3) * 3;
  UNITS.push([...Array(9)].map((_, k) => (r0 + ((k / 3) | 0)) * 9 + c0 + (k % 3)));      // boxes
}
export const PEERS = [...Array(81)].map((_, i) => {
  const s = new Set();
  for (const unit of UNITS) if (unit.includes(i)) for (const j of unit) if (j !== i) s.add(j);
  return [...s];
});

const ALL = 0x3fe; // bits 1..9
const popcount = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };

// ---- seeded randomness -------------------------------------------------------
export function hashString(str) {           // FNV-1a, 32-bit
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---- grids ---------------------------------------------------------------------
function toGrid(input) {
  if (typeof input === 'string') {
    const g = new Uint8Array(81);
    for (let i = 0; i < 81; i++) { const d = input.charCodeAt(i) - 48; g[i] = d >= 1 && d <= 9 ? d : 0; }
    return g;
  }
  return Uint8Array.from(input);
}
const toString = (g) => Array.from(g).join('');

// Backtracking search with bitmasks and minimum-remaining-values ordering.
// Calls onSolution(grid) for each solution; stops when it returns true.
function search(g, rand, onSolution) {
  const rows = new Uint16Array(9), cols = new Uint16Array(9), boxes = new Uint16Array(9);
  for (let i = 0; i < 81; i++) {
    const d = g[i];
    if (!d) continue;
    const b = 1 << d;
    if ((rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & b) return; // contradictory givens
    rows[ROW[i]] |= b; cols[COL[i]] |= b; boxes[BOX[i]] |= b;
  }
  let stop = false;
  (function rec() {
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & ALL;
      const n = popcount(m);
      if (n === 0) return;
      if (n < bestN) { best = i; bestMask = m; bestN = n; if (n === 1) break; }
    }
    if (best === -1) { stop = onSolution(g) === true; return; }
    const digits = [];
    for (let d = 1; d <= 9; d++) if (bestMask & (1 << d)) digits.push(d);
    if (rand) shuffle(digits, rand);
    const r = ROW[best], c = COL[best], x = BOX[best];
    for (const d of digits) {
      const b = 1 << d;
      g[best] = d; rows[r] |= b; cols[c] |= b; boxes[x] |= b;
      rec();
      g[best] = 0; rows[r] &= ~b; cols[c] &= ~b; boxes[x] &= ~b;
      if (stop) return;
    }
  })();
}

export function countSolutions(input, limit = 2) {
  const g = toGrid(input);
  let n = 0;
  search(g, null, () => ++n >= limit);
  return n;
}

export function solve(input) {
  const g = toGrid(input);
  let out = null;
  search(g, null, (s) => { out = toString(s); return true; });
  return out;
}

function randomFullGrid(rand) {
  const g = new Uint8Array(81);
  let out = null;
  search(g, rand, (s) => { out = Uint8Array.from(s); return true; });
  return out;
}

// Can the puzzle be finished using only naked and hidden singles?
export function solvableBySingles(input) {
  const g = toGrid(input);
  for (;;) {
    let progress = false;
    const cand = new Uint16Array(81);
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      let m = ALL;
      for (const p of PEERS[i]) if (g[p]) m &= ~(1 << g[p]);
      if (!m) return false;
      cand[i] = m;
    }
    for (let i = 0; i < 81; i++) {                       // naked singles
      if (!g[i] && popcount(cand[i]) === 1) { g[i] = 31 - Math.clz32(cand[i]); progress = true; }
    }
    if (!progress) {
      for (const unit of UNITS) {                          // hidden singles
        for (let d = 1; d <= 9; d++) {
          const b = 1 << d;
          let spot = -1, n = 0, placed = false;
          for (const i of unit) {
            if (g[i] === d) { placed = true; break; }
            if (!g[i] && cand[i] & b) { spot = i; n++; }
          }
          if (!placed && n === 1) { g[spot] = d; progress = true; }
        }
        if (progress) break;
      }
    }
    if (!progress) return g.every((d) => d !== 0);
  }
}

export function isCompleteAndValid(input) {
  const g = toGrid(input);
  for (const unit of UNITS) {
    let m = 0;
    for (const i of unit) m |= 1 << g[i];
    if (m !== ALL) return false;
  }
  return true;
}

// Indices of filled cells that share a digit with a peer.
export function findConflicts(values) {
  const out = new Set();
  for (const unit of UNITS) {
    const seen = new Map();
    for (const i of unit) {
      const d = values[i];
      if (!d) continue;
      if (seen.has(d)) { out.add(i); out.add(seen.get(d)); } else seen.set(d, i);
    }
  }
  return out;
}

// ---- daily puzzle -------------------------------------------------------------------
const cache = new Map();

export function generateDaily(date, level = 'medium') {
  const cfg = DIFFICULTIES[level];
  if (!cfg) throw new Error(`Unknown difficulty: ${level}`);
  const key = `${date}|${level}`;
  if (cache.has(key)) return cache.get(key);

  const rand = mulberry32(hashString(`jackychen.xyz|sudoku|${key}`));
  let result = null;
  for (let attempt = 0; attempt < 30 && !result; attempt++) {
    const solution = randomFullGrid(rand);
    const puzzle = Uint8Array.from(solution);
    let clues = 81;
    // Pass 1 removes symmetric pairs (prettier grids); pass 2 removes single cells to go sparser.
    for (const symmetric of [true, false]) {
      for (const i of shuffle([...Array(81).keys()], rand)) {
        if (clues <= cfg.target) break;
        if (!puzzle[i]) continue;
        const cells = [i];
        const mirror = 80 - i;
        if (symmetric && mirror !== i && puzzle[mirror] && clues - 2 >= cfg.target) cells.push(mirror);
        const saved = cells.map((c) => puzzle[c]);
        for (const c of cells) puzzle[c] = 0;
        const ok = countSolutions(puzzle, 2) === 1 && (!cfg.singlesOnly || solvableBySingles(puzzle));
        if (ok) clues -= cells.length;
        else cells.forEach((c, k) => { puzzle[c] = saved[k]; });
      }
    }
    if (cfg.needsMore && solvableBySingles(puzzle)) continue;
    result = { date, level, puzzle: toString(puzzle), solution: toString(solution), clues };
  }
  cache.set(key, result);
  return result;
}

// ---- dates (local calendar days, as YYYY-MM-DD) -------------------------------------
export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function isISODate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  return addDays(s, 0) === s;
}
