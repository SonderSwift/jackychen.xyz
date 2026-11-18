// Pure helpers for the events builder: front matter, a tiny markdown subset, time zones, .ics.
// No dependencies. Tested in _dev/tests/events.test.mjs.

export const CATEGORIES = {
  main:     { emoji: '🍲', label: 'Main',     plural: 'mains' },
  side:     { emoji: '🥗', label: 'Side',     plural: 'sides' },
  dessert:  { emoji: '🍰', label: 'Dessert',  plural: 'desserts' },
  drinks:   { emoji: '🧋', label: 'Drinks',   plural: 'drinks' },
  supplies: { emoji: '🧺', label: 'Supplies', plural: 'supplies' },
};

// ---- escaping --------------------------------------------------------------------------------

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---- event files -----------------------------------------------------------------------------

// A deliberately small YAML-ish front matter:
//   key: value
//   list_key:
//     - item
//     - item
// Lines starting with # are comments. Values are strings; true/false become booleans.
export function parseFrontMatter(text) {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  if (!m) throw new Error('Event file must start with a --- front matter block ---');
  const meta = {};
  let listKey = null;
  for (const [i, raw] of m[1].split('\n').entries()) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item) {
      if (!listKey) throw new Error(`Front matter line ${i + 1}: list item without a key above it`);
      meta[listKey].push(item[1].trim());
      continue;
    }
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`Front matter line ${i + 1}: expected "key: value", got "${line}"`);
    const [, key, value] = kv;
    if (value === '') { meta[key] = []; listKey = key; continue; }
    listKey = null;
    meta[key] = value === 'true' ? true : value === 'false' ? false : unquote(value);
  }
  return { meta, body: m[2] };
}

function unquote(v) {
  const q = /^(["'])(.*)\1$/.exec(v);
  return q ? q[2] : v;
}

// "main 2, dessert 3" → { main: 2, dessert: 3 }
export function parseWishlist(value) {
  if (!value || (Array.isArray(value) && value.length === 0)) return {};
  const out = {};
  for (const part of String(value).split(',')) {
    const m = /^\s*([a-z]+)\s+(\d+)\s*$/.exec(part);
    if (!m || !CATEGORIES[m[1]]) throw new Error(`wishlist: can't read "${part.trim()}" (use e.g. "main 2, dessert 3")`);
    out[m[1]] = Number(m[2]);
  }
  return out;
}

// "bike-party | Everyone at the bridge" → { name, alt }
export function parsePhoto(line) {
  const [name, ...alt] = String(line).split('|');
  const n = name.trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(n)) throw new Error(`photos: "${n}" should be an image base name like "bike-party"`);
  return { name: n, alt: alt.join('|').trim() };
}

// Split the markdown body into the invite text and an optional "## Recap" section.
export function splitRecap(body) {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const i = lines.findIndex((l) => /^##\s+recap\s*$/i.test(l.trim()));
  if (i === -1) return { description: body.trim(), recap: '' };
  return { description: lines.slice(0, i).join('\n').trim(), recap: lines.slice(i + 1).join('\n').trim() };
}

// ---- markdown (small subset) ------------------------------------------------------------------
// Paragraphs, ## / ### headings (shifted down one level), - and 1. lists, > quotes,
// **bold**, *italic*, `code`, [links](https://…). Everything is escaped first.

export function renderMarkdown(md, { headingShift = 1 } = {}) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // { tag, items }
  let quote = [];

  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => {
    if (list) { out.push(`<${list.tag}>${list.items.map((t) => `<li>${inline(t)}</li>`).join('')}</${list.tag}>`); list = null; }
  };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushAll(); continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      flushAll();
      const level = Math.min(6, m[1].length + headingShift);
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line)) || (m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara(); flushQuote();
      const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(m[1]);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flushPara(); flushList();
      quote.push(m[1]);
    } else if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ' ' + line.trim(); // continuation of a list item
    } else {
      flushList(); flushQuote();
      para.push(line.trim());
    }
  }
  flushAll();
  return out.join('\n');
}

export function inline(text) {
  let s = escapeHtml(text);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  const urls = [];
  s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (all, label, url) => {
    if (!/^(https?:\/\/|\/|#|mailto:)/i.test(url.replace(/&amp;/g, '&'))) return label;
    urls.push(url);
    const external = /^https?:\/\//i.test(url);
    return `<a href="\u0001${urls.length - 1}\u0001"${external ? ' rel="noopener"' : ''}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => urls[Number(i)]);
  return s;
}

// ---- time ---------------------------------------------------------------------------------------

// Offset of `tz` from UTC at instant `ts`, in ms (e.g. -8h for Los Angeles in winter).
function tzOffsetMs(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ts));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ts;
}

// "2026-12-12 18:00" in "America/Los_Angeles" → Date (the real instant).
export function zonedToUtc(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(String(local).trim());
  if (!m) throw new Error(`Can't read time "${local}" (use "2026-12-12 18:00")`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let ts = wall - tzOffsetMs(wall, tz);
  ts = wall - tzOffsetMs(ts, tz); // second pass settles DST boundaries
  return new Date(ts);
}

function clock(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
    .formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t)?.value;
  const mins = g('minute') === '00' ? '' : `:${g('minute')}`;
  return { text: `${g('hour')}${mins}`, ampm: g('dayPeriod').toLowerCase() };
}

function ymd(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// Everything the templates need to show a date.
export function describeWhen(start, end, tz) {
  const f = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(start);
  const a = clock(start, tz);
  const b = clock(end, tz);
  const sameDay = ymd(start, tz) === ymd(end, tz) || end - start < 12 * 3600e3;
  let time = a.ampm === b.ampm ? `${a.text}–${b.text}${b.ampm}` : `${a.text}${a.ampm}–${b.text}${b.ampm}`;
  if (!sameDay) time = `${a.text}${a.ampm} – ${new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(end)} ${b.text}${b.ampm}`;
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(start).find((p) => p.type === 'timeZoneName').value;
  return {
    weekday: f({ weekday: 'short' }),
    weekdayLong: f({ weekday: 'long' }),
    month: f({ month: 'short' }),
    monthLong: f({ month: 'long' }),
    day: f({ day: 'numeric' }),
    year: f({ year: 'numeric' }),
    dateShort: f({ weekday: 'short', month: 'short', day: 'numeric' }),
    dateLong: f({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    time,
    zone,
  };
}

// ---- .ics -----------------------------------------------------------------------------------------

function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsFold(line) {
  // Fold at 73 UTF-8 bytes, never splitting a character.
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > 73) { out.push(cur); cur = ' '; bytes = 1; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

function icsTime(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function buildIcs({ slug, title, start, end, where, description, url }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//jackychen.xyz//events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${slug}@jackychen.xyz`,
    `DTSTAMP:${icsTime(start)}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsEscape(title)}`,
    where ? `LOCATION:${icsEscape(where)}` : null,
    `DESCRIPTION:${icsEscape(description)}`,
    `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

// ---- whole event ---------------------------------------------------------------------------------

const REQUIRED = ['title', 'start', 'blurb'];

export function readEvent(text, slug) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) {
    throw new Error(`${slug}: file names must be lowercase letters, numbers and dashes, e.g. 2026-12-12-dumpling-night.md`);
  }
  const { meta, body } = parseFrontMatter(text);
  for (const k of REQUIRED) if (!meta[k]) throw new Error(`${slug}: missing "${k}:"`);
  const tz = meta.timezone || 'America/Los_Angeles';
  const start = zonedToUtc(meta.start, tz);
  const end = meta.end ? zonedToUtc(meta.end, tz) : new Date(start.getTime() + 4 * 3600e3);
  if (end <= start) throw new Error(`${slug}: "end" must be after "start"`);
  const potluck = meta.potluck || 'open';
  if (!['open', 'closed', 'off'].includes(potluck)) throw new Error(`${slug}: potluck must be open, closed or off`);
  const closesAt = meta.potluck_closes ? zonedToUtc(meta.potluck_closes, tz) : end;
  if (meta.partiful && !/^https:\/\//.test(meta.partiful)) throw new Error(`${slug}: partiful should be a https:// link`);
  if (meta.cover && !/^[a-z0-9][a-z0-9._-]*$/i.test(meta.cover)) throw new Error(`${slug}: cover should be an image base name like "bike-party"`);
  const { description, recap } = splitRecap(body);
  return {
    slug,
    title: meta.title,
    blurb: meta.blurb,
    emoji: meta.emoji || '🎉',
    where: meta.where || '',
    tz,
    start,
    end,
    when: describeWhen(start, end, tz),
    cover: meta.cover || '',
    coverAlt: meta.cover_alt || '',
    partiful: meta.partiful || '',
    potluck,
    closesAt,
    wishlist: parseWishlist(meta.wishlist),
    photos: (Array.isArray(meta.photos) ? meta.photos : []).map(parsePhoto),
    draft: meta.draft === true,
    description,
    recap,
  };
}

// Upcoming until the event ends.
export function isPast(event, now = new Date()) {
  return now >= event.end;
}
