# jackychen.xyz

Personal website of Jacky Chen, served by GitHub Pages from `master` (custom domain in `CNAME`).

Hand-written HTML, CSS and JavaScript. No build step, no dependencies.

```
index.html            Home: hero, Saga, things I've made, the light, films, interests, principles
about/                About + work timeline
archive/              "Earlier versions of me": films, old blog excerpts, the 2017 site
archive/v1/           The first version of this site (2017–2021), preserved as it was
sudoku/               Daily Sudoku
404.html
assets/css/           site.css (design tokens + shared components), sudoku.css, archive.css
assets/js/            site.js (shared), home.js, light.js (LED simulation), archive.js
assets/js/sudoku/     engine.mjs (puzzle generation, pure + tested), app.js (UI)
assets/img/           Photos (resized to 480/960/1600 px) and the seal favicon
_dev/tests/           Node tests (folders starting with "_" are not published)
```

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Pages use root-relative paths (`/assets/...`), so serve from the repo root.

## Tests

```sh
node --test _dev/tests/*.test.mjs
```

The sudoku engine is deterministic: `generateDaily(date, level)` seeds a PRNG from the date and difficulty, builds a full grid, then removes clues while keeping exactly one solution. Easy and Medium must be solvable with naked/hidden singles; Hard must need more.

## Adding things

- **Photos:** resize into `assets/img/` (`name-480.jpg`, `name-960.jpg`, `name-1600.jpg`) and add a `<figure class="frame">` to the contact sheet in `index.html`. Only use photos you took or have permission to share.
- **Projects:** add an `<li>` to `.made-list` in `index.html`.
- **Films:** copy a `.film` block; `data-video` is the YouTube id. Players load only on click.
- **Archive entries:** copy an `<article class="entry" data-kind="writing|film|site">` in `archive/index.html`. Keep quoted text verbatim.
