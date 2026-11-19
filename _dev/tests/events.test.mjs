// Run with: node --test _dev/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontMatter, parseWishlist, parsePhoto, splitRecap, renderMarkdown, inline,
  zonedToUtc, describeWhen, buildIcs, readEvent, isPast,
} from '../events-lib.mjs';
import { initials } from '../../_worker/src/initials.js';

const SAMPLE = `---
title: Dumpling Night
start: 2026-12-12 18:00
end: 2026-12-12 22:00
blurb: We fold, we steam.
# a comment
partiful: https://partiful.com/e/abc
wishlist: main 2, dessert 3
photos:
  - bike-party | Everyone at the bridge
  - lake
---
Bring an apron.

## Recap
It was *great*.
`;

test('front matter: scalars, comments, lists', () => {
  const { meta, body } = parseFrontMatter(SAMPLE);
  assert.equal(meta.title, 'Dumpling Night');
  assert.equal(meta.partiful, 'https://partiful.com/e/abc');
  assert.deepEqual(meta.photos, ['bike-party | Everyone at the bridge', 'lake']);
  assert.match(body, /^Bring an apron/);
});

test('front matter: missing block and bad lines are explained', () => {
  assert.throws(() => parseFrontMatter('title: x'), /front matter/);
  assert.throws(() => parseFrontMatter('---\njust words\n---\n'), /expected "key: value"/);
});

test('wishlist and photos', () => {
  assert.deepEqual(parseWishlist('main 2, dessert 3'), { main: 2, dessert: 3 });
  assert.deepEqual(parseWishlist(''), {});
  assert.throws(() => parseWishlist('soup 2'), /wishlist/);
  assert.deepEqual(parsePhoto('bike-party | At the bridge | at night'), { name: 'bike-party', alt: 'At the bridge | at night' });
  assert.throws(() => parsePhoto('../etc/passwd'), /base name/);
});

test('recap is split out of the body', () => {
  assert.deepEqual(splitRecap('Hi\n\n## Recap\nGood times'), { description: 'Hi', recap: 'Good times' });
  assert.deepEqual(splitRecap('Only an invite'), { description: 'Only an invite', recap: '' });
});

test('markdown escapes HTML and only links safe URLs', () => {
  assert.equal(renderMarkdown('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(inline('[x](javascript:alert(1))'), 'x');
  assert.equal(inline('[site](https://a.b/?q=1&r=2)'), '<a href="https://a.b/?q=1&amp;r=2" rel="noopener">site</a>');
  assert.equal(inline('[home](/events/)'), '<a href="/events/">home</a>');
  assert.equal(inline('[x](https://x.com/_a_/*b*)'), '<a href="https://x.com/_a_/*b*" rel="noopener">x</a>');
  assert.equal(inline('"><img onerror=x>'), '&quot;&gt;&lt;img onerror=x&gt;');
});

test('markdown blocks', () => {
  const html = renderMarkdown('## Plan\n\n- **food**\n- `games`\n\n1. one\n2. two\n\n> quote\n\nsnake_case_word and _em_');
  assert.match(html, /<h3>Plan<\/h3>/);
  assert.match(html, /<ul><li><strong>food<\/strong><\/li><li><code>games<\/code><\/li><\/ul>/);
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(html, /<blockquote><p>quote<\/p><\/blockquote>/);
  assert.match(html, /snake_case_word and <em>em<\/em>/);
});

test('local times become real instants, across DST', () => {
  assert.equal(zonedToUtc('2026-12-12 18:00', 'America/Los_Angeles').toISOString(), '2026-12-13T02:00:00.000Z');
  assert.equal(zonedToUtc('2026-07-04 18:00', 'America/Los_Angeles').toISOString(), '2026-07-05T01:00:00.000Z');
  assert.equal(zonedToUtc('2026-12-12 18:00', 'Asia/Taipei').toISOString(), '2026-12-12T10:00:00.000Z');
  assert.throws(() => zonedToUtc('Dec 12 6pm', 'America/Los_Angeles'), /Can't read time/);
});

test('human date strings', () => {
  const tz = 'America/Los_Angeles';
  const w = describeWhen(zonedToUtc('2026-12-12 18:00', tz), zonedToUtc('2026-12-12 22:30', tz), tz);
  assert.equal(w.dateShort, 'Sat, Dec 12');
  assert.equal(w.time, '6–10:30pm');
  assert.equal(w.zone, 'PST');
  const x = describeWhen(zonedToUtc('2026-12-12 11:00', tz), zonedToUtc('2026-12-12 14:00', tz), tz);
  assert.equal(x.time, '11am–2pm');
});

test('.ics escapes text and folds long lines', () => {
  const ics = buildIcs({
    slug: 'x', title: 'Pie, cake; and \\ more', start: new Date('2026-12-13T02:00:00Z'), end: new Date('2026-12-13T06:00:00Z'),
    where: 'Mission', description: 'a'.repeat(200), url: 'https://jackychen.xyz/events/x/',
  });
  assert.match(ics, /SUMMARY:Pie\\, cake\\; and \\\\ more\r\n/);
  assert.match(ics, /DTSTART:20261213T020000Z/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
});

test('readEvent fills defaults and validates', () => {
  const e = readEvent(SAMPLE, '2026-12-12-dumpling-night');
  assert.equal(e.potluck, 'open');
  assert.equal(e.closesAt.toISOString(), e.end.toISOString());
  assert.deepEqual(e.wishlist, { main: 2, dessert: 3 });
  assert.equal(e.photos.length, 2);
  assert.equal(e.recap, 'It was *great*.');
  assert.equal(isPast(e, new Date('2026-12-12T00:00:00Z')), false);
  assert.equal(isPast(e, new Date('2026-12-14T00:00:00Z')), true);
  assert.throws(() => readEvent(SAMPLE, 'Bad Name'), /file names/);
  assert.throws(() => readEvent(SAMPLE.replace('https://partiful', 'http://partiful'), 'ok'), /partiful/);
  assert.throws(() => readEvent(SAMPLE.replace('title: Dumpling Night\n', ''), 'ok'), /missing "title:"/);
  assert.equal(e.password, true, 'guest password is on unless turned off');
  assert.equal(e.passwordVersion, 1);
  const off = readEvent(SAMPLE.replace('blurb:', 'password: off\npassword_version: 3\nblurb:'), 'ok');
  assert.equal(off.password, false);
  assert.equal(off.passwordVersion, 3);
  assert.throws(() => readEvent(SAMPLE.replace('blurb:', 'password: maybe\nblurb:'), 'ok'), /password should be on or off/);
  assert.throws(() => readEvent(SAMPLE.replace('blurb:', 'password_version: 0\nblurb:'), 'ok'), /password_version/);
});

test('initials: what strangers and the archive see', () => {
  assert.equal(initials('Mei Lin'), 'M.L.');
  assert.equal(initials('mei'), 'M.');
  assert.equal(initials('Ana de la Cruz'), 'A.C.');
  assert.equal(initials('🥟 Bo'), 'B.');
  assert.equal(initials('🥟'), 'Guest');
  assert.equal(initials('   '), 'Guest');
  assert.equal(initials('陳家豪'), '陳.');
  assert.equal(initials('élodie roux'), 'É.R.');
  assert.equal(initials('M.L.'), 'M.L.', 'already masked stays put');
  assert.equal(initials(initials('Jacky Chen')), 'J.C.');
});
