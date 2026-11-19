# jackychen.xyz

Personal website of Jacky Chen, served by GitHub Pages from `master` (custom domain in `CNAME`).

Hand-written HTML, CSS and JavaScript. No build step, no dependencies. The one exception is `/events/`: its pages are generated from markdown by a zero-dependency Node script, and its potluck sign-ups live in a small Cloudflare Worker (`_worker/`).

```
index.html            Home: hero, Saga, things I've made, the light, films, interests, principles
about/                About + work timeline
archive/              "Earlier versions of me": films, old blog excerpts, the 2017 site
archive/v1/           The first version of this site (2017–2021), preserved as it was
sudoku/               Daily Sudoku
events/               GENERATED from _events/ by _dev/build-events.mjs; don't edit by hand
_events/              One markdown file per event (+ README with every field)
_worker/              Potluck API: Cloudflare Worker + D1 (not published by Pages)
404.html
assets/css/           site.css (design tokens + shared components), sudoku.css, archive.css, events.css
assets/js/            site.js (shared), home.js, light.js (LED simulation), archive.js, event.js (potluck), events-index.js
assets/js/sudoku/     engine.mjs (puzzle generation, pure + tested), app.js (UI)
assets/img/           Photos (resized to 480/960/1600 px) and the seal favicon
_dev/                 build-events.mjs + events-lib.mjs; tests/ holds Node tests (folders starting with "_" are not published)
```

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Pages use root-relative paths (`/assets/...`), so serve from the repo root.

## Tests

```sh
node --test _dev/tests/*.test.mjs   # sudoku engine + events builder
cd _worker && npm test              # potluck API over HTTP (starts its own wrangler dev + local D1)
```

The sudoku engine is deterministic: `generateDaily(date, level)` seeds a PRNG from the date and difficulty, builds a full grid, then removes clues while keeping exactly one solution. Easy and Medium must be solvable with naked/hidden singles; Hard must need more.

## Adding things

- **Photos:** resize into `assets/img/` (`name-480.jpg`, `name-960.jpg`, `name-1600.jpg`) and add a `<figure class="frame">` to the contact sheet in `index.html`. Only use photos you took or have permission to share.
- **Projects:** add an `<li>` to `.made-list` in `index.html`.
- **Films:** copy a `.film` block; `data-video` is the YouTube id. Players load only on click.
- **Archive entries:** copy an `<article class="entry" data-kind="writing|film|site">` in `archive/index.html`. Keep quoted text verbatim.

## Events and potlucks

**Add or edit an event:** write `_events/YYYY-MM-DD-name.md` (see `_events/README.md`), then

```sh
node _dev/build-events.mjs     # writes events/, incl. a share image per event (uses local Chrome)
```

and commit `_events/` and `events/` together. Upcoming events move to the archive on their own after they end
(the index re-sorts in the browser); rebuild after the event only to add the recap, photos and frozen list.

**Run the potluck locally** (two terminals):

```sh
python3 -m http.server 8000
cd _worker && npm install && cp .dev.vars.example .dev.vars && npm run migrate:local && npm run dev   # API on :8787
```

On `localhost`, event pages talk to `http://localhost:8787` automatically.

**How sign-ups work:** the Worker stores only name, dish and category in D1. Adding an entry returns a random
edit token that stays in the guest's browser; only that token (or the host key) can change or remove it.
Events with `password: on` (the default) show initials to everyone without the guest password; the password
(an HMAC of the host key, slug and `password_version`) is traded once for a long guest key that the browser keeps.
Password tries share the write limit below.
Spam protection: hidden honeypot field, 10 writes/minute per IP or IPv6 /64 (Cloudflare rate limiter, nothing
stored; failed edit/host-key attempts count too), 120 entries per event and 30 new entries/minute per event.
If junk ever gets through: `npx wrangler d1 execute potluck --remote --command "DELETE FROM signups WHERE event = '<slug>' AND created_at > <ms timestamp>"`. The Worker reads `events/events.json` from the live
site to know which events exist and when sign-ups close.

**First deploy of the Worker** (once):

```sh
cd _worker
npx wrangler login                          # opens a browser; free Cloudflare account
npx wrangler d1 create potluck              # paste the printed database_id into wrangler.toml
npm run migrate:remote
openssl rand -base64 24 | npx wrangler secret put HOST_KEY   # 24+ chars; save it in your password manager for #host mode
npm run deploy                              # prints https://jackychen-potluck.<you>.workers.dev
```

Put that URL in `_events/config.json` as `api`, rebuild, commit, push. Later Worker changes: `npm run deploy`.

When a change touches both the Worker and the event pages, deploy the Worker first, then push the site
(the Worker accepts the older `events.json`; the newer pages need the newer Worker). Roll back in reverse:
site first, then Worker (`npx wrangler rollback`). Changing `HOST_KEY` also changes every event's guest
password, so paste the new ones into Partiful afterwards.
