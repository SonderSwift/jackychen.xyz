// "Mei Lin" → "M.L.", "Mei" → "M.". Used by the Worker (what strangers see) and by the site
// build (what the archive keeps). Safe to run twice: text that is already initials is kept.

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const ALREADY = /^(?:\p{L}\.){1,2}$/u;

export function initials(name) {
  const s = String(name ?? '').trim();
  if (ALREADY.test(s)) return s;
  const letters = s.split(/\s+/)
    .map((word) => [...segmenter.segment(word)].map((g) => g.segment).find((g) => /^\p{L}/u.test(g)))
    .filter(Boolean);
  if (!letters.length) return 'Guest';
  const picked = letters.length === 1 ? letters : [letters[0], letters[letters.length - 1]];
  return picked.map((g) => `${g.toLocaleUpperCase()}.`).join('');
}
