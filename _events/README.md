# Events

One markdown file per event. `node _dev/build-events.mjs` turns them into `/events/`.
This folder starts with `_`, so GitHub Pages doesn't publish it.

## New event

1. Copy `2026-12-12-dumpling-night.md` to `_events/YYYY-MM-DD-short-name.md`. The file name becomes the URL:
   `jackychen.xyz/events/YYYY-MM-DD-short-name/`. Lowercase, numbers and dashes only. Don't rename it after
   people have signed up (the sign-ups are stored under that name).
2. Fill in the top block (fields below) and write the invite underneath in plain markdown.
3. `node _dev/build-events.mjs`, check it at `http://localhost:8000/events/`, commit, push.

## Fields

| Field | | |
|---|---|---|
| `title` | required | |
| `start` | required | Local time: `2026-12-12 18:00` |
| `end` | optional | Defaults to 4 hours after start |
| `timezone` | optional | Defaults to `America/Los_Angeles` |
| `blurb` | required | One or two sentences. Used on the card and in the text-message preview. |
| `where` | optional | Shown publicly. The repo and site are public, so put a neighborhood, not a street address; the address belongs on Partiful. |
| `emoji` | optional | Used when there is no cover photo, and on the share image. Default 🎉 |
| `cover` / `cover_alt` | optional | Image base name in `assets/img/` (`bike-party` → `bike-party-960.jpg` + `-1600.jpg`) and its description |
| `partiful` | optional | `https://partiful.com/e/...`, shown as the RSVP button |
| `potluck` | optional | `open` (default), `closed`, or `off` (no potluck section) |
| `potluck_closes` | optional | Local time sign-ups stop. Defaults to the end of the event. |
| `wishlist` | optional | `side 3, dessert 2, drinks 3` shows "2/3" progress on each category sticker |
| `photos` | optional | A list, one per line: `  - name | description` (same image naming as `cover`) |
| `draft` | optional | `true` keeps it off `/events/` (the page still works if you share its link) |
| `password` | optional | `on` (default): only guests with the password see names and can sign up; everyone else sees initials. `off`: open to anyone, names public |
| `password_version` | optional | Bump it (`2`, `3`…) to change the guest password, e.g. if it leaked. Default `1` |

Categories are `main`, `side`, `dessert`, `drinks`, `supplies`.

## After the event

1. Resize photos into `assets/img/` (`name-480.jpg`, `name-960.jpg`, `name-1600.jpg`), add them under `photos:`.
2. Add a `## Recap` heading at the end of the file and write a few lines under it.
3. Save the final potluck list into the repo, so the archive never depends on the database:
   `node _dev/build-events.mjs --freeze YYYY-MM-DD-short-name` (writes `YYYY-MM-DD-short-name.potluck.json` and rebuilds).
4. Commit and push.

## Guest password (with Partiful)

1. In Partiful, turn on **Guest Approval** so only guests you approve see the event details.
2. Open the event page with `#host`, unlock host mode, and press **Copy text for Partiful**.
3. Paste it into the Partiful event details. It has a link that unlocks the potluck in one tap, plus the
   password for anyone who opens the page some other way.

Approved guests see first names and can add a dish. Everyone else sees dishes with initials only.
The password is worked out from your host key, so it is never in this repo. The archive (`--freeze`)
always keeps initials only.

## Host mode

Open any event page with `#host` on the end (`/events/<slug>/#host`), enter the host key (the `HOST_KEY`
secret you set on the Worker), and every entry gets a Remove button, real names show, and the guest password
appears with copy buttons. The key stays in that browser only.
