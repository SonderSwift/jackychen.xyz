// Run with: node --test _dev/tests/
// (Folders starting with "_" are not published by GitHub Pages/Jekyll.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDaily, countSolutions, solvableBySingles, isCompleteAndValid,
  findConflicts, addDays, DIFFICULTIES,
} from '../../assets/js/sudoku/engine.mjs';

const DATES = ['2026-11-11', '2026-11-12', '2027-01-01', '2026-02-28', '2030-07-04', '2026-12-31'];
const LEVELS = Object.keys(DIFFICULTIES);

test('same date and difficulty always produce the same puzzle', () => {
  for (const level of LEVELS) {
    const a = generateDaily('2026-11-11', level);
    const b = generateDaily('2026-11-11', level);
    assert.equal(a.puzzle, b.puzzle);
    assert.equal(a.solution, b.solution);
  }
});

test('different dates and difficulties produce different puzzles', () => {
  const seen = new Set();
  for (const d of DATES) for (const level of LEVELS) seen.add(generateDaily(d, level).puzzle);
  assert.equal(seen.size, DATES.length * LEVELS.length);
});

test('solution is a valid completed grid and agrees with the givens', () => {
  for (const d of DATES) for (const level of LEVELS) {
    const { puzzle, solution } = generateDaily(d, level);
    assert.equal(puzzle.length, 81);
    assert.ok(isCompleteAndValid(solution), `${d} ${level} solution invalid`);
    for (let i = 0; i < 81; i++) if (puzzle[i] !== '0') assert.equal(puzzle[i], solution[i]);
  }
});

test('every puzzle has exactly one solution', () => {
  for (const d of DATES) for (const level of LEVELS) {
    const { puzzle } = generateDaily(d, level);
    assert.equal(countSolutions(puzzle, 2), 1, `${d} ${level} not unique`);
  }
});

test('clue counts get sparser with difficulty', () => {
  for (const d of DATES) {
    const [e, m, h] = LEVELS.map((l) => generateDaily(d, l).clues);
    assert.ok(e >= 36 && e <= 46, `easy clues ${e}`);
    assert.ok(m >= 28 && m <= 36, `medium clues ${m}`);
    assert.ok(h <= 30, `hard clues ${h}`);
    assert.ok(e > m && m > h, `ordering ${e} ${m} ${h}`);
  }
});

test('easy and medium are solvable with singles alone; hard needs more', () => {
  let hardNeedsMore = 0;
  for (const d of DATES) {
    assert.ok(solvableBySingles(generateDaily(d, 'easy').puzzle));
    assert.ok(solvableBySingles(generateDaily(d, 'medium').puzzle));
    if (!solvableBySingles(generateDaily(d, 'hard').puzzle)) hardNeedsMore++;
  }
  assert.ok(hardNeedsMore >= DATES.length - 1, `only ${hardNeedsMore} hard puzzles need more than singles`);
});

test('generation is fast enough to run in the browser', () => {
  const t0 = performance.now();
  for (const level of LEVELS) generateDaily('2026-11-20', level);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `took ${ms.toFixed(0)}ms for three puzzles`);
});

test('findConflicts flags duplicate digits in a row, column and box', () => {
  const v = Array(81).fill(0);
  v[0] = 5; v[8] = 5;        // same row
  v[9] = 3; v[72] = 3;       // same column (col 0)
  v[30] = 7; v[50] = 7;      // same box (rows 3-5, cols 3-5)
  v[40] = 1;                 // alone
  const c = findConflicts(v);
  assert.deepEqual([...c].sort((a, b) => a - b), [0, 8, 9, 30, 50, 72]);
});

test('addDays handles month and year boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
});
