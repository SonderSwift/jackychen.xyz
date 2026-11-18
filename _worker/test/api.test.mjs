// Boundary tests: a real `wrangler dev` (workerd + local D1) over HTTP, against a fake site
// that serves /events/events.json. Run with: npm test (from _worker/).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST_KEY = 'test-host-key-0123456789abcdef';
const ALLOWED = 'http://allowed.test';
const WORKER_PORT = 8790 + Math.floor(Math.random() * 100);

const hour = 3600e3;
const EVENTS = {
  events: [
    { slug: 'open-party', potluck: 'open', closesAt: new Date(Date.now() + 24 * hour).toISOString() },
    { slug: 'over-party', potluck: 'open', closesAt: new Date(Date.now() - hour).toISOString() },
    { slug: 'closed-party', potluck: 'closed', closesAt: new Date(Date.now() + 24 * hour).toISOString() },
    { slug: 'no-potluck', potluck: 'off', closesAt: new Date(Date.now() + 24 * hour).toISOString() },
  ],
};

let site, worker, persist, BASE;
let ipCounter = 0;
const freshIp = () => `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

before(async () => {
  site = createServer((req, res) => {
    if (req.url === '/events/events.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(EVENTS)); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const siteOrigin = `http://127.0.0.1:${site.address().port}`;

  persist = mkdtempSync(join(tmpdir(), 'potluck-test-'));
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'potluck', '--local', '--persist-to', persist], { cwd: WORKER_DIR, stdio: 'ignore' });
  worker = spawn('npx', [
    'wrangler', 'dev', '--port', String(WORKER_PORT), '--ip', '127.0.0.1', '--persist-to', persist,
    '--var', `SITE_ORIGIN:${siteOrigin}`, '--var', `HOST_KEY:${HOST_KEY}`, '--var', `ALLOWED_ORIGINS:${ALLOWED}`,
  ], { cwd: WORKER_DIR, stdio: 'ignore', detached: true });
  BASE = `http://127.0.0.1:${WORKER_PORT}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('wrangler dev did not start');
});

after(() => {
  if (worker) try { process.kill(-worker.pid); } catch { /* already gone */ }
  site?.close();
  if (persist) rmSync(persist, { recursive: true, force: true });
});

async function api(method, path, { body, token, host, ip = freshIp(), headers = {}, raw } = {}) {
  const h = { 'cf-connecting-ip': ip, ...headers };
  if (body !== undefined || raw !== undefined) h['content-type'] ??= 'application/json';
  if (token) h.authorization = `Bearer ${token}`;
  if (host) h['x-host-key'] = host;
  const res = await fetch(BASE + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  return { status: res.status, headers: res.headers, data: await res.json().catch(() => null) };
}
const add = (slug, body, opts) => api('POST', `/api/events/${slug}/signups`, { body, ...opts });
const list = async (slug) => (await api('GET', `/api/events/${slug}`)).data.signups;

test('anyone can add to an open potluck and everyone sees it, without the token', async () => {
  const r = await add('open-party', { name: '  Mei  ', dish: 'Mango sago', category: 'dessert' });
  assert.equal(r.status, 201);
  assert.equal(r.data.signup.name, 'Mei');
  assert.match(r.data.token, /^[A-Za-z0-9_-]{32}$/);
  const rows = await list('open-party');
  const row = rows.find((s) => s.id === r.data.signup.id);
  assert.deepEqual(Object.keys(row).sort(), ['category', 'createdAt', 'dish', 'id', 'name', 'updatedAt']);
  assert.ok(!JSON.stringify(rows).includes(r.data.token));
});

test('unknown events, events without a potluck, and odd slugs are 404', async () => {
  assert.equal((await api('GET', '/api/events/nope')).status, 404);
  assert.equal((await api('GET', '/api/events/no-potluck')).status, 404);
  assert.equal((await api('GET', '/api/events/..%2Fetc')).status, 404);
  assert.equal((await add('nope', { name: 'a', dish: 'b' })).status, 404);
});

test('closed potlucks are readable but refuse new entries', async () => {
  const g = await api('GET', '/api/events/closed-party');
  assert.equal(g.status, 200);
  assert.equal(g.data.event.open, false);
  assert.equal((await add('closed-party', { name: 'a', dish: 'b' })).status, 409);
  assert.equal((await add('over-party', { name: 'a', dish: 'b' })).status, 409, 'past potluck_closes');
});

test('input is validated and bounded', async () => {
  assert.equal((await add('open-party', { name: '', dish: 'x' })).status, 400);
  assert.equal((await add('open-party', { name: 'a'.repeat(41), dish: 'x' })).status, 400);
  assert.equal((await add('open-party', { name: 'a', dish: 'x'.repeat(81) })).status, 400);
  assert.equal((await add('open-party', { name: 'a', dish: 'x', category: 'soup' })).status, 400);
  assert.equal((await add('open-party', { name: ['a'], dish: 'x' })).status, 400);
  assert.equal((await add('open-party', undefined, { raw: 'name=a', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal((await add('open-party', undefined, { raw: '{not json' })).status, 400);
  assert.equal((await add('open-party', undefined, { raw: JSON.stringify({ name: 'a', dish: 'b', pad: 'x'.repeat(3000) }) })).status, 413);
});

test('hostile text: control and bidi characters are stripped, markup is stored as plain text', async () => {
  const r = await add('open-party', { name: 'Eve‮\u0000\n', dish: '<img src=x onerror=alert(1)> & 👩‍🍳' });
  assert.equal(r.status, 201);
  assert.equal(r.data.signup.name, 'Eve');
  assert.equal(r.data.signup.dish, '<img src=x onerror=alert(1)> & 👩‍🍳'); // rendered with textContent on the page
  const whitespaceOnly = await add('open-party', { name: '​‮ ', dish: 'x' });
  assert.equal(whitespaceOnly.status, 400);
});

test('honeypot: looks like success, stores nothing', async () => {
  const before = (await list('open-party')).length;
  const r = await add('open-party', { name: 'Bot', dish: 'Spam', hp_note: 'http://spam.example' });
  assert.equal(r.status, 201);
  assert.equal(r.data.signup, null);
  assert.equal((await list('open-party')).length, before);
});

test('only the token holder can edit or remove an entry', async () => {
  const mine = await add('open-party', { name: 'Ana', dish: 'Chips', category: 'side' });
  const theirs = await add('open-party', { name: 'Bo', dish: 'Soda', category: 'drinks' });
  const id = mine.data.signup.id;

  assert.equal((await api('PATCH', `/api/signups/${id}`, { body: { dish: 'Salsa' } })).status, 403);
  assert.equal((await api('PATCH', `/api/signups/${id}`, { body: { dish: 'Salsa' }, token: theirs.data.token })).status, 403);
  assert.equal((await api('DELETE', `/api/signups/${id}`, { token: 'x'.repeat(32) })).status, 403);

  const p = await api('PATCH', `/api/signups/${id}`, { body: { dish: 'Chips and salsa', category: null }, token: mine.data.token });
  assert.equal(p.status, 200);
  assert.deepEqual([p.data.signup.name, p.data.signup.dish, p.data.signup.category], ['Ana', 'Chips and salsa', null]);
  assert.equal((await api('PATCH', `/api/signups/${id}`, { body: { name: '' }, token: mine.data.token })).status, 400);

  assert.equal((await api('DELETE', `/api/signups/${id}`, { token: mine.data.token })).status, 200);
  assert.equal((await api('DELETE', `/api/signups/${id}`, { token: mine.data.token })).status, 404);
  assert.ok(!(await list('open-party')).some((s) => s.id === id));
  assert.equal((await api('DELETE', '/api/signups/not-a-uuid', { token: mine.data.token })).status, 404);
});

test('the host key can remove anything; a wrong key cannot', async () => {
  const r = await add('open-party', { name: 'Troll', dish: 'Nothing' });
  const id = r.data.signup.id;
  assert.equal((await api('DELETE', `/api/signups/${id}`, { host: 'wrong-key-wrong-key' })).status, 403);
  assert.equal((await api('DELETE', `/api/signups/${id}`, { host: HOST_KEY })).status, 200);
});

test('CORS: allowed origins only', async () => {
  const ok = await api('GET', '/api/events/open-party', { headers: { origin: ALLOWED } });
  assert.equal(ok.headers.get('access-control-allow-origin'), ALLOWED);
  const no = await api('GET', '/api/events/open-party', { headers: { origin: 'https://evil.example' } });
  assert.equal(no.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(`${BASE}/api/signups/x`, { method: 'OPTIONS', headers: { origin: ALLOWED, 'access-control-request-method': 'PATCH' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-methods'), /PATCH/);
});

test('failed auth attempts are throttled like writes', async () => {
  const r = await add('open-party', { name: 'Vic', dish: 'Victim dish' });
  const id = r.data.signup.id;
  const ip = '10.8.8.8';
  const codes = [];
  for (let i = 0; i < 11; i++) codes.push((await api('DELETE', `/api/signups/${id}`, { host: `guess-${i}-xxxxxxxxxxxxxxxxxxxx`, ip })).status);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(403));
  assert.equal(codes[10], 429);
});

test('IPv6 visitors share a limit across their /64', async () => {
  const codes = [];
  for (let i = 0; i < 11; i++) codes.push((await add('open-party', { name: `V6-${i}`, dish: 'x' }, { ip: `2001:db8:aa:bb::${(i + 1).toString(16)}` })).status);
  assert.equal(codes[10], 429);
});

test('rate limit: one IP gets 10 writes a minute', async () => {
  const ip = '10.9.9.9';
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await add('open-party', { name: `R${i}`, dish: `d${i}` }, { ip })).status);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(201));
  assert.deepEqual(codes.slice(10), [429, 429]);
  assert.equal((await add('open-party', { name: 'Other', dish: 'x' })).status, 201, 'other IPs unaffected');
});

test('per-event burst cap: 30 new entries a minute across everyone', async () => {
  // Earlier tests already added some entries to open-party within this minute; fill up to the cap.
  const codes = [];
  for (let i = 0; i < 32; i++) codes.push((await add('open-party', { name: `B${i}`, dish: `d${i}` })).status);
  assert.ok(codes.includes(429), `expected a 429, got ${codes.join(',')}`);
  assert.equal(codes.indexOf(429), codes.lastIndexOf(201) + 1, 'once capped, stays capped');
});
