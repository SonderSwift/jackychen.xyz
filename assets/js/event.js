// Event page: photo lightbox + the live potluck list. No dependencies.
import { initLightbox, reducedMotion } from './site.js';

const CATS = {
  main: { emoji: '🍲', label: 'Main', plural: 'mains' },
  side: { emoji: '🥗', label: 'Side', plural: 'sides' },
  dessert: { emoji: '🍰', label: 'Dessert', plural: 'desserts' },
  drinks: { emoji: '🧋', label: 'Drinks', plural: 'drinks' },
  supplies: { emoji: '🧺', label: 'Supplies', plural: 'supplies' },
};
const POLL_MS = 15000;

function initPotluck(root) {
  const slug = root.dataset.slug;
  const frozen = root.dataset.frozen === 'true';
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const api = local ? `http://${location.hostname}:8787` : root.dataset.api;
  const wishlist = safeJson(root.dataset.wishlist) || {};

  const $ = (sel) => root.querySelector(sel);
  const form = $('[data-form]');
  const list = $('[data-list]');
  const empty = $('[data-empty]');
  const status = $('[data-status]');
  const hostPanel = $('[data-host-panel]');

  let items = [];
  let open = root.dataset.open === 'true';
  let editingId = null;
  let loaded = false;
  let busy = false;
  let writes = 0;      // bumps on every write so an older in-flight poll can't overwrite newer data
  let lastJson = '';
  let startEdit = () => {};
  let stopEdit = () => {};
  const seen = new Set();

  // ---- small persistence helpers (per phone; never required) -----------------------------
  const storeKey = `potluck:v1:${slug}`;
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
  const tokens = () => (read(storeKey) || {}).tokens || {};
  const saveToken = (id, token) => { const t = tokens(); t[id] = token; write(storeKey, { tokens: t }); };
  const dropToken = (id) => { const t = tokens(); delete t[id]; write(storeKey, { tokens: t }); };
  const hostKey = () => read('potluck:host');

  // ---- frozen archive: the list is already in the HTML ---------------------------------------
  if (frozen) {
    items = [...list.children].map((li) => ({ category: li.dataset.cat === 'other' ? null : li.dataset.cat }));
    renderTally();
    return;
  }

  // ---- talking to the Worker ---------------------------------------------------------------------
  async function call(method, path, body, auth) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
    if (auth?.host) headers['X-Host-Key'] = auth.host;
    let res;
    try {
      res = await fetch(api + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error('Couldn’t reach the potluck list. Check your connection and try again?');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again?'), { status: res.status });
    return data;
  }

  async function refresh() {
    if (busy) return;
    const started = writes;
    try {
      const data = await call('GET', `/api/events/${encodeURIComponent(slug)}`);
      if (started !== writes || busy) return; // a write happened meanwhile; its own refresh will be newer
      if (open && !data.event.open) closeForm();
      loaded = true;
      if (status.dataset.kind === 'load') say('');
      if (editingId && !data.signups.some((s) => s.id === editingId)) { stopEdit(); say('That entry was removed.', 'error'); }
      const json = JSON.stringify(data.signups);
      if (json === lastJson) return; // nothing changed: leave the DOM (and keyboard focus) alone
      lastJson = json;
      items = data.signups;
      render();
    } catch (err) {
      if (!loaded) say(err.status === 404 ? 'The potluck list isn’t set up for this event yet.' : 'Couldn’t load the list right now. It’ll retry on its own.', 'error', 'load');
    }
  }

  // ---- rendering -----------------------------------------------------------------------------------
  function render() {
    renderTally();
    renderList();
    if (form) dupeCheck();
  }

  function renderTally() {
    const counts = Object.fromEntries(Object.keys(CATS).map((k) => [k, 0]));
    for (const it of items) if (it.category in counts) counts[it.category] += 1;
    for (const li of root.querySelectorAll('.sticker')) {
      const k = li.dataset.cat;
      const b = li.querySelector('[data-count]');
      if (b.textContent !== String(counts[k])) {
        if (b.textContent !== '0' || counts[k] > 0) bump(li);
        b.textContent = counts[k];
      }
      li.classList.toggle('is-covered', Boolean(wishlist[k]) && counts[k] >= wishlist[k]);
      li.setAttribute('aria-label', `${CATS[k].label}: ${counts[k]}${wishlist[k] ? ` of ${wishlist[k]} wanted` : ''}`);
    }
    let total = root.querySelector('.tally-total');
    if (!total) {
      total = document.createElement('li');
      total.className = 'tally-total';
      root.querySelector('[data-tally]').append(total);
    }
    const n = items.length;
    total.textContent = n === 0 ? '' : `${n} ${n === 1 ? 'thing' : 'things'} on the table so far`;
  }

  function renderList() {
    const mine = tokens();
    const host = hostKey();
    const canChange = (it) => (open && mine[it.id]) || host;
    const firstPaint = seen.size === 0;
    list.replaceChildren(...items.map((it) => {
      const c = CATS[it.category];
      const li = el('li', 'dish');
      li.dataset.cat = it.category || 'other';
      li.dataset.id = it.id;
      if (!firstPaint && !seen.has(it.id) && !reducedMotion()) li.classList.add('is-new');
      seen.add(it.id);

      const emoji = el('span', 'dish-emoji', c ? c.emoji : '🍽️');
      emoji.setAttribute('aria-hidden', 'true');
      const body = el('span', 'dish-body');
      body.append(el('span', 'dish-name', it.dish));
      const who = el('span', 'dish-who', it.name);
      if (mine[it.id]) who.append(el('span', 'you-badge', 'you'));
      body.append(who);
      li.append(emoji, body);

      if (canChange(it)) {
        const actions = el('span', 'dish-actions');
        if (mine[it.id] && open && form) {
          const edit = el('button', '', 'Edit');
          edit.type = 'button';
          edit.setAttribute('aria-label', `Edit ${it.dish}`);
          edit.addEventListener('click', () => startEdit(it));
          actions.append(edit);
        }
        const del = el('button', '', 'Remove');
        del.type = 'button';
        del.setAttribute('aria-label', `Remove ${it.dish}`);
        del.addEventListener('click', () => armRemove(del, it));
        actions.append(del);
        li.append(actions);
      }
      return li;
    }));
    empty.hidden = items.length > 0;
  }

  // ---- form ------------------------------------------------------------------------------------------
  if (form) {
    const nameInput = form.elements.name;
    const dishInput = form.elements.dish;
    const submit = form.querySelector('[data-submit]');
    const cancel = form.querySelector('[data-cancel]');
    const title = form.querySelector('[data-form-title]');
    const savedName = read('potluck:name');
    if (savedName) nameInput.value = savedName;

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const name = nameInput.value.trim();
      const dish = dishInput.value.trim();
      nameInput.setAttribute('aria-invalid', String(!name));
      dishInput.setAttribute('aria-invalid', String(!dish));
      if (!name) { say('Add your name so people know who’s bringing it.', 'error'); nameInput.focus(); return; }
      if (!dish) { say('What are you bringing? Even “a good attitude” counts.', 'error'); dishInput.focus(); return; }
      const category = form.elements.category.value || null;

      busy = true;
      writes += 1;
      submit.disabled = true;
      try {
        if (editingId) {
          const auth = tokens()[editingId] ? { token: tokens()[editingId] } : { host: hostKey() };
          await call('PATCH', `/api/signups/${editingId}`, { name, dish, category }, auth);
          say('Updated! ✨', 'good');
        } else {
          const res = await call('POST', `/api/events/${encodeURIComponent(slug)}/signups`, {
            name, dish, category, hp_note: form.elements.hp_note.value,
          });
          if (!res.signup) throw new Error('Couldn’t save that one. Try again?');
          saveToken(res.signup.id, res.token);
          say(`You’re on the list! See you there, ${name}. 🎉`, 'good');
          celebrate(submit, category);
        }
        write('potluck:name', name);
        stopEdit();
        busy = false;
        await refresh();
      } catch (err) {
        if (err.status === 404 && editingId) { stopEdit(); busy = false; await refresh(); }
        say(err.message, 'error');
      } finally {
        busy = false;
        submit.disabled = false;
      }
    });

    function setCategory(value) {
      for (const r of form.elements.category) r.checked = r.value === value;
    }

    cancel.addEventListener('click', () => { stopEdit(); say(''); });
    dishInput.addEventListener('input', dupeCheck);

    startEdit = (it) => {
      editingId = it.id;
      nameInput.value = it.name;
      dishInput.value = it.dish;
      setCategory(it.category || '');
      form.classList.add('is-editing');
      title.textContent = 'Edit your entry';
      submit.textContent = 'Save changes';
      cancel.hidden = false;
      form.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
      dishInput.focus({ preventScroll: true });
      dupeCheck();
    };
    stopEdit = () => {
      editingId = null;
      dishInput.value = '';
      setCategory('');
      form.classList.remove('is-editing');
      title.textContent = 'Put yourself down';
      submit.textContent = 'Put me down 🙌';
      cancel.hidden = true;
      dupeCheck();
    };
  }

  // "Heads up: Mei is already bringing mango sago"
  function dupeCheck() {
    if (!form) return;
    const box = form.querySelector('[data-dupe]');
    const words = keywords(form.elements.dish.value);
    const hit = words.size && items.find((it) => it.id !== editingId && [...keywords(it.dish)].some((w) => words.has(w)));
    if (!hit) { box.hidden = true; return; }
    box.replaceChildren('Heads up: ', el('b', '', hit.name), ' is already bringing “', el('i', '', hit.dish), '”. Still welcome, just so you know!');
    box.hidden = false;
  }

  // ---- remove (two taps, no pop-up) ------------------------------------------------------------------
  function armRemove(btn, it) {
    if (!btn.classList.contains('is-armed')) {
      btn.classList.add('is-armed');
      btn.textContent = 'Sure?';
      setTimeout(() => { if (btn.isConnected) { btn.classList.remove('is-armed'); btn.textContent = 'Remove'; } }, 3500);
      return;
    }
    removeItem(it);
  }

  async function removeItem(it) {
    const token = tokens()[it.id];
    const auth = token && open ? { token } : { host: hostKey() };
    busy = true;
    writes += 1;
    try {
      await call('DELETE', `/api/signups/${it.id}`, null, auth);
      dropToken(it.id);
      if (editingId === it.id) stopEdit();
      say('Removed.', 'good');
    } catch (err) {
      if (err.status === 403 && auth.host) { write('potluck:host', null); syncHost(); say('That host key didn’t work.', 'error'); }
      else say(err.message, 'error');
    } finally {
      busy = false;
      await refresh();
    }
  }

  function closeForm() {
    open = false;
    if (form) {
      const p = el('p', 'potluck-closed', 'Sign-ups are closed. Here’s the final spread.');
      form.replaceWith(p);
    }
  }

  // ---- host mode (#host) -------------------------------------------------------------------------------
  function syncHost() {
    const on = location.hash === '#host' || Boolean(hostKey());
    hostPanel.hidden = !on;
    hostPanel.classList.toggle('is-unlocked', Boolean(hostKey()));
    renderList();
  }
  hostPanel.querySelector('[data-host-form]').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = hostPanel.querySelector('input');
    if (input.value.trim()) write('potluck:host', input.value.trim());
    input.value = '';
    say('Host mode on. Remove buttons are showing on every entry.', 'good');
    syncHost();
  });
  hostPanel.querySelector('[data-host-off]').addEventListener('click', () => {
    write('potluck:host', null);
    if (location.hash === '#host') history.replaceState(null, '', location.pathname);
    say('');
    syncHost();
  });
  window.addEventListener('hashchange', syncHost);

  // ---- status line ---------------------------------------------------------------------------------------
  function say(text, kind = '', tag = '') {
    status.textContent = text;
    status.className = `potluck-status${kind ? ` is-${kind}` : ''}`;
    status.dataset.kind = tag;
  }

  // ---- go --------------------------------------------------------------------------------------------------
  syncHost();
  refresh();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
}

// ---- helpers ----------------------------------------------------------------------------------------------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

const STOP = new Set(['the', 'and', 'with', 'some', 'for', 'bag', 'bags', 'box', 'homemade', 'home', 'made', 'big', 'small', 'few', 'lots', 'of', 'a', 'an', 'my', 'our', 'fresh']);
function keywords(text) {
  return new Set(String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)));
}

function bump(node) {
  if (reducedMotion()) return;
  node.classList.add('bump');
  setTimeout(() => node.classList.remove('bump'), 260);
}

function celebrate(origin, category) {
  if (reducedMotion() || !origin.animate) return;
  const r = origin.getBoundingClientRect();
  const pool = category && CATS[category] ? [CATS[category].emoji, '✨', '🎉', CATS[category].emoji] : ['🥟', '🎉', '✨', '🍰', '🧋', '🥗'];
  for (let i = 0; i < 16; i++) {
    const s = document.createElement('span');
    s.className = 'confetti';
    s.textContent = pool[i % pool.length];
    s.style.left = `${r.left + r.width / 2 - 13}px`;
    s.style.top = `${r.top + r.height / 2 - 13}px`;
    document.body.append(s);
    const angle = (Math.PI * 2 * i) / 16 + Math.random() * 0.4;
    const dist = 90 + Math.random() * 110;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 60;
    s.animate([
      { transform: 'translate(0,0) scale(.6) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(1.1) rotate(${(Math.random() - 0.5) * 240}deg)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${dx * 1.1}px, ${dy + 140}px) scale(.9) rotate(${(Math.random() - 0.5) * 360}deg)`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 400, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => s.remove();
  }
}

// ---- start ------------------------------------------------------------------------------------------------
initLightbox();
const root = document.querySelector('[data-potluck]');
if (root) initPotluck(root);
