# Potluck guest password, initials and food stickers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only password holders see names and can add dishes; everyone else sees initials; category icons become drawn stickers.

**Architecture:** The Worker derives a per-event password and a long guest key from HOST_KEY (HMAC). A rate-limited unlock route trades the password for the guest key; reads and writes send the key. One shared `initials()` module is used by the Worker and the build script.

**Tech Stack:** Cloudflare Worker + D1, zero-dependency Node build, vanilla JS/CSS, SVG sprite.

**Spec:** `docs/superpowers/specs/2026-11-18-potluck-guest-password-design.md`

## Global Constraints
- Collect nothing beyond name and dish. No secrets in the repo.
- No new dependencies. Worker main module keeps only `export default`.
- Password format `WORD-XXXXXX`, alphabet `23456789ABCDEFGHJKMNPQRSTVWXYZ`; typed input compared case- and punctuation-insensitively.
- Password tries: same 10/min per-visitor limiter as writes, checked before verifying.

## Review Focus
- A guest whose stored key is stale (password version bumped) → page drops the key, shows the lock card, does not error-loop.
- A wrong password typed repeatedly → 403 then 429, never a 500.
- `#p=` in the URL → stripped from the address bar after unlock (screenshots, shared links).
- Password-off events → behave exactly as before (names public, no lock card).
- Freezing a list twice, or an already-masked list → initials stay intact ("M.L." stays "M.L.").

---

### Task 1: Shared `initials()`
**Files:** Create `_worker/src/initials.js`; Test `_dev/tests/events.test.mjs`
**Produces:** `export function initials(name: string): string`
- [ ] Test `initials`: `'Mei Lin'→'M.L.'`, `'mei'→'M.'`, `'Ana de la Cruz'→'A.C.'`, `'🥟 Bo'→'B.'`, `'🥟'→'Guest'`, `'陳家豪'→'陳.'`, `'M.L.'→'M.L.'`, `'  '→'Guest'`.
- [ ] Implement with `Intl.Segmenter` graphemes; first letter-initial word and last; idempotent on `/^(\p{L}\.){1,2}$/u`.
- [ ] `node --test _dev/tests/*.test.mjs` passes.

### Task 2: Worker gate
**Files:** Modify `_worker/src/index.js`, `_worker/test/api.test.mjs`
**Consumes:** `initials()`. Registry fields `password: boolean`, `passwordVersion: number`.
**Produces:** `POST /api/events/:slug/unlock {password}` → `{guestKey}` | 403 | 429. GET returns `event.{guest, locked, password?}` (password only for host); non-guests get `name` as initials. POST signups on locked events requires `X-Guest-Key` (or host) else 403. CORS allows `X-Guest-Key`.
- [ ] Tests (fixture `open-party` password on, `open-public` password off): GET w/o key masks names + `guest:false`; unlock wrong 403 ×10 then 429; unlock right → key; GET with key → names; POST w/o key 403, with key 201; host GET includes `password`; public event: names visible, POST works keyless; token edit works without guest key.
- [ ] Update existing tests to unlock first where they add to `open-party`.
- [ ] `npm test` in `_worker` passes.

### Task 3: Build + front matter
**Files:** Modify `_dev/events-lib.mjs`, `_dev/build-events.mjs`, `_events/README.md`, sample event
- [ ] `readEvent`: `password: on|off` (default on), `password_version` positive int (default 1); test both + invalid.
- [ ] events.json carries `password`, `passwordVersion`; freeze maps names through `initials()`.
- [ ] Template: lock card (`data-lock`) shown when locked; form rendered `hidden` when password on; Partiful link in lock card; host panel gets password box + copy buttons; icons via sprite.

### Task 4: Stickers
**Files:** Create `assets/img/potluck.svg` (symbols `pl-main`, `pl-side`, `pl-dessert`, `pl-drinks`, `pl-supplies`, `pl-other`); Modify `assets/css/events.css`
- [ ] Draw; check light/dark at 390px and desktop.

### Task 5: Client
**Files:** Modify `assets/js/event.js`
- [ ] `#p=` → unlock → store key `potluck:guest:<slug>` → strip hash. Send `X-Guest-Key` (and `X-Host-Key` when host) on GET/POST. Toggle form/lock card from `event.guest`; stale key → drop + lock card. Host panel shows password + copy. Icons in dish cards.
- [ ] Browser check locally: lock, wrong password, right password, link unlock, sign-up, host copy, public event.

### Task 6: Review, deploy
- [ ] Fresh reviewer on the diff; act on findings.
- [ ] Deploy Worker first (it accepts old events.json: missing `password` = off), then site.
