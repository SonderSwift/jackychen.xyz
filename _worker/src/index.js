// Potluck API for jackychen.xyz/events.
//
//   GET    /api/events/:slug            → { event: { slug, open, closesAt, locked, guest, host, password? }, signups: [...] }
//   POST   /api/events/:slug/unlock     { password }  → { guestKey }
//   POST   /api/events/:slug/signups    { name, dish, category?, hp_note? }  → { signup, token }
//   PATCH  /api/signups/:id             { name?, dish?, category? }  (Authorization: Bearer <token> or X-Host-Key)
//   DELETE /api/signups/:id             (Authorization: Bearer <token> or X-Host-Key)
//
// Who may call what:
//   - Anyone can read an event's list. On a locked event (password on), callers without the
//     guest key get initials instead of names.
//   - Anyone can try the event's password (throttled like a write); the right one returns the
//     guest key (X-Guest-Key), a long HMAC nobody can guess, so reads with it need no throttle.
//   - Guests (anyone, if the event has no password) can add an entry while the potluck is open
//     (rate limited, honeypot, caps).
//   - Only the holder of an entry's edit token can change or remove it, and only while open.
//   - The host (X-Host-Key = HOST_KEY secret) can change or remove any entry at any time, and
//     sees the event's password.
//
// Passwords and guest keys are derived from HOST_KEY, the slug and the event's passwordVersion,
// so nothing is stored and bumping the version in the event file changes both.
//
// Which events exist and when they close comes from the static site's /events/events.json,
// so the site's event files stay the single source of truth.

import { initials } from './initials.js';

const CATEGORIES = ['main', 'side', 'dessert', 'drinks', 'supplies'];
const LIMITS = { name: 40, dish: 80, perEvent: 120, perEventPerMinute: 30, bodyBytes: 2048 };
const HONEYPOT = 'hp_note';
const MIN_HOST_KEY = 24;
const PASS_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'; // no 0/O, 1/I/L, U
const PASS_CHARS = 10;

const REGISTRY_TTL_MS = 60_000;
let registry = { at: 0, events: null, origin: '' };

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(request, env);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, cors);
      console.error(err);
      return json({ error: 'Something went wrong on our side. Try again in a moment?' }, 500, cors);
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const m = request.method;

  if (parts[0] !== 'api') throw new HttpError(404, 'Not found.');
  if (parts.length === 2 && parts[1] === 'health' && m === 'GET') return json({ ok: true });

  if (parts[1] === 'events' && parts.length === 3 && m === 'GET') return listSignups(request, env, parts[2]);
  if (parts[1] === 'events' && parts.length === 4 && parts[3] === 'unlock' && m === 'POST') {
    return unlock(request, env, parts[2]);
  }
  if (parts[1] === 'events' && parts.length === 4 && parts[3] === 'signups' && m === 'POST') {
    return createSignup(request, env, parts[2]);
  }
  if (parts[1] === 'signups' && parts.length === 3 && (m === 'PATCH' || m === 'DELETE')) {
    return changeSignup(request, env, parts[2], m);
  }
  throw new HttpError(404, 'Not found.');
}

// ---------------------------------------------------------------------------------------------

async function listSignups(request, env, slug) {
  const event = await findEvent(env, slug);
  const who = await access(request, env, event);
  const { results } = await env.DB
    .prepare('SELECT id, name, dish, category, created_at, updated_at FROM signups WHERE event = ? ORDER BY created_at, id')
    .bind(event.slug).all();
  const out = { ...publicEvent(event), guest: who.guest, host: who.host };
  if (who.host && isLocked(event)) out.password = await eventPassword(env, event);
  return json({ event: out, signups: results.map((r) => publicSignup(r, !who.guest)) });
}

async function unlock(request, env, slug) {
  const event = await findEvent(env, slug);
  if (!isLocked(event)) return json({ guestKey: null });
  // Throttle before checking, so each guess costs a write.
  await rateLimit(request, env);
  const body = await readBody(request);
  // The word in front is only there to remember it by, so the code alone works too.
  const given = normalizePassword(body.password);
  const code = normalizePassword(await passwordCode(env, event));
  const tried = given.startsWith(passwordWord(event)) ? given.slice(passwordWord(event).length) : given;
  if (!given || !(await safeEqual(await sha256(tried), await sha256(code)))) {
    throw new HttpError(403, 'That’s not it. The password is in the Partiful event details.');
  }
  return json({ guestKey: await guestKey(env, event) });
}

async function createSignup(request, env, slug) {
  const event = await findEvent(env, slug);
  if (!isOpen(event)) throw new HttpError(409, 'The potluck sign-up for this one is closed.');
  await rateLimit(request, env);
  if (!(await access(request, env, event)).guest) {
    throw new HttpError(403, 'This list is for guests. Enter the password from the Partiful invite first.');
  }

  const body = await readBody(request);
  // Honeypot: people never see this field. Pretend it worked so bots don't learn anything.
  if (typeof body[HONEYPOT] === 'string' && body[HONEYPOT].trim() !== '') {
    return json({ signup: null, token: null }, 201);
  }
  const fields = validate(body, { partial: false });

  const id = crypto.randomUUID();
  const token = randomToken();
  const now = Date.now();
  // One statement, so simultaneous sign-ups can't slip past the caps between a count and an insert.
  const { meta } = await env.DB
    .prepare(`INSERT INTO signups (id, event, name, dish, category, token_hash, created_at, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7
      WHERE (SELECT COUNT(*) FROM signups WHERE event = ?2) < ?8
        AND (SELECT COUNT(*) FROM signups WHERE event = ?2 AND created_at > ?9) < ?10`)
    .bind(id, event.slug, fields.name, fields.dish, fields.category ?? null, await sha256(token), now,
      LIMITS.perEvent, now - 60_000, LIMITS.perEventPerMinute)
    .run();
  if (!meta.changes) {
    const { total } = await env.DB.prepare('SELECT COUNT(*) AS total FROM signups WHERE event = ?').bind(event.slug).first();
    if (total >= LIMITS.perEvent) throw new HttpError(409, 'This table is full! Text Jacky if you still want to bring something.');
    throw new HttpError(429, 'Lots of sign-ups at once. Give it a minute and try again.');
  }
  const signup = { id, name: fields.name, dish: fields.dish, category: fields.category ?? null, createdAt: now, updatedAt: now };
  return json({ signup, token }, 201);
}

async function changeSignup(request, env, id, method) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, 'That entry is gone.');
  const row = await env.DB.prepare('SELECT * FROM signups WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'That entry is gone.');

  const host = await isHost(request, env);
  if (!host) {
    // Throttle before checking credentials, so wrong tokens and wrong host keys cost a write too.
    await rateLimit(request, env);
    if (request.headers.has('x-host-key')) throw new HttpError(403, 'That host key didn’t work.');
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token || !(await safeEqual(await sha256(token), row.token_hash))) {
      throw new HttpError(403, 'Only the person who added this can change it.');
    }
    const event = await findEvent(env, row.event);
    if (!isOpen(event)) throw new HttpError(409, 'The potluck is closed, so the list is final.');
  }

  if (method === 'DELETE') {
    await env.DB.prepare('DELETE FROM signups WHERE id = ?').bind(id).run();
    return json({ deleted: id });
  }

  const fields = validate(await readBody(request), { partial: true });
  const next = {
    name: fields.name ?? row.name,
    dish: fields.dish ?? row.dish,
    category: 'category' in fields ? fields.category : row.category,
  };
  const now = Date.now();
  await env.DB
    .prepare('UPDATE signups SET name = ?, dish = ?, category = ?, updated_at = ? WHERE id = ?')
    .bind(next.name, next.dish, next.category, now, id).run();
  return json({ signup: { id, ...next, createdAt: row.created_at, updatedAt: now } });
}

// ---------------------------------------------------------------------------------------------

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const s = value
    .normalize('NFC')
    // control chars, line/paragraph separators, and invisible format chars (bidi overrides etc.),
    // but keep the zero-width joiner so emoji like 👩‍🍳 survive.
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]|(?!‍)\p{Cf}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const len = Array.from(s).length;
  return len >= 1 && len <= max ? s : null;
}

function validate(body, { partial }) {
  const out = {};
  if (!partial || 'name' in body) {
    out.name = cleanText(body.name, LIMITS.name);
    if (!out.name) throw new HttpError(400, `Add your name (up to ${LIMITS.name} characters).`);
  }
  if (!partial || 'dish' in body) {
    out.dish = cleanText(body.dish, LIMITS.dish);
    if (!out.dish) throw new HttpError(400, `Say what you're bringing (up to ${LIMITS.dish} characters).`);
  }
  if ('category' in body) {
    const c = body.category;
    if (c === null || c === '' || c === undefined) out.category = null;
    else if (CATEGORIES.includes(c)) out.category = c;
    else throw new HttpError(400, 'Unknown category.');
  }
  return out;
}

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  const tooBig = () => new HttpError(413, 'That is a lot of text for a potluck.');
  const declared = Number(request.headers.get('content-length'));
  if (declared > LIMITS.bodyBytes) throw tooBig();
  const buf = await request.arrayBuffer();
  if (buf.byteLength > LIMITS.bodyBytes) throw tooBig();
  const text = new TextDecoder().decode(buf);
  let body;
  try { body = JSON.parse(text); } catch { throw new HttpError(400, 'Send JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send JSON.');
  return body;
}

async function findEvent(env, slug) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) throw new HttpError(404, 'No such event.');
  const events = await loadRegistry(env);
  const event = events.find((e) => e.slug === slug);
  if (!event || event.potluck === 'off') throw new HttpError(404, 'No such event.');
  return event;
}

async function loadRegistry(env) {
  const origin = env.SITE_ORIGIN;
  if (registry.events && registry.origin === origin && Date.now() - registry.at < REGISTRY_TTL_MS) return registry.events;
  try {
    const res = await fetch(`${origin}/events/events.json`, { cf: { cacheTtl: 60 } });
    if (!res.ok) throw new Error(`events.json ${res.status}`);
    const data = await res.json();
    registry = { at: Date.now(), events: Array.isArray(data.events) ? data.events : [], origin };
  } catch (err) {
    if (!registry.events) throw err;           // first load: nothing to fall back on
    console.warn('using stale event list', err); // otherwise keep serving the last good list
  }
  return registry.events;
}

function isOpen(event) {
  if (event.potluck !== 'open') return false;
  return !event.closesAt || Date.now() < Date.parse(event.closesAt);
}

function publicEvent(e) {
  return { slug: e.slug, open: isOpen(e), closesAt: e.closesAt || null, locked: isLocked(e) };
}

function publicSignup(r, masked) {
  const name = masked ? initials(r.name) : r.name;
  return { id: r.id, name, dish: r.dish, category: r.category, createdAt: r.created_at, updatedAt: r.updated_at };
}

// ---- guest password ---------------------------------------------------------------------------

// Events from an older events.json have no `password` field: treat them as open to everyone.
function isLocked(event) {
  return event.password === true;
}

async function access(request, env, event) {
  const host = await isHost(request, env);
  // A wrong host key costs a write, like a wrong password (the key itself is far too long to guess).
  if (!host && request.headers.has('x-host-key')) await rateLimit(request, env);
  if (host || !isLocked(event)) return { host, guest: true };
  const given = request.headers.get('x-guest-key');
  const guest = Boolean(given) && (await safeEqual(await sha256(given), await sha256(await guestKey(env, event))));
  return { host, guest };
}

async function derive(env, purpose, event) {
  // Without a strong HOST_KEY the derived secrets would be guessable, so refuse instead.
  if (!env.HOST_KEY || env.HOST_KEY.length < MIN_HOST_KEY) throw new HttpError(503, 'The potluck isn’t set up yet.');
  const version = Number.isInteger(event.passwordVersion) && event.passwordVersion > 0 ? event.passwordVersion : 1;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.HOST_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${purpose}:${event.slug}:${version}`));
  return new Uint8Array(sig);
}

// 2026-12-12-dumpling-night → "DUMPLING-7Q4KX-M9P2B": a word to remember it by, plus 10 characters
// (30^10 ≈ 6×10^14 possibilities, so even many addresses at 10 tries a minute get nowhere).
// Guests mostly arrive through the #p= link, so the length costs little.
async function eventPassword(env, event) {
  const code = await passwordCode(env, event);
  return `${passwordWord(event)}-${code.slice(0, 5)}-${code.slice(5)}`;
}

async function passwordCode(env, event) {
  const bytes = await derive(env, 'password', event);
  let code = '';
  for (let i = 0; i < PASS_CHARS; i++) code += PASS_ALPHABET[bytes[i] % PASS_ALPHABET.length];
  return code;
}

// From the slug (the event's URL), not the title, so renaming an event keeps its password.
function passwordWord(event) {
  const words = event.slug.toUpperCase().match(/[A-Z]{3,}/g) || [];
  return (words[0] || 'POTLUCK').slice(0, 10);
}

function normalizePassword(s) {
  return typeof s === 'string' ? s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 64) : '';
}

async function guestKey(env, event) {
  const bytes = await derive(env, 'guest', event);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function rateLimit(request, env) {
  if (!env.WRITE_LIMIT) return;
  const key = rateKey(request.headers.get('cf-connecting-ip') || 'unknown');
  const { success } = await env.WRITE_LIMIT.limit({ key });
  if (!success) throw new HttpError(429, 'Whoa, slow down a little. Try again in a minute.');
}

// IPv6 users typically control a whole /64, so count the /64 as one visitor.
function rateKey(ip) {
  if (!ip.includes(':')) return ip;
  let [head, tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

async function isHost(request, env) {
  const given = request.headers.get('x-host-key');
  if (!given || !env.HOST_KEY || env.HOST_KEY.length < MIN_HOST_KEY) return false;
  return safeEqual(await sha256(given), await sha256(env.HOST_KEY));
}

function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Host-Key, X-Guest-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function safeEqual(a, b) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  return crypto.subtle.timingSafeEqual(ea, eb);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
