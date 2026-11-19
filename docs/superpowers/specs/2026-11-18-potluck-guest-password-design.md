# Potluck: guest password, initials, food stickers

Approved by Jacky in chat on 2026-11-18 ("Looks good. Proceed").

## Why
The potluck list is on a public page. Jacky wants only invited guests to see who's bringing
what and to add to it, without accounts, and the page should feel made for potlucks (food
icons, not generic emoji).

## Goals
- Only guests Jacky approved on Partiful can see first names and add a dish.
- Everyone else sees dishes, categories and counts, with initials instead of names.
- The archive (frozen list) keeps initials only, forever.
- Category icons that look like stickers drawn for this site.

## Non-goals / anti-goals
- No Partiful API integration (there is no official one; the unofficial one drives a logged-in
  browser and breaks easily).
- No accounts, emails or phone numbers. Still only a name and a dish.
- No secret in the public repo.

## Approaches considered
1. **Verify the Partiful RSVP directly.** No official API. Rejected.
2. **Secret link in a text blast to "Going" guests.** Misses guests who RSVP late unless re-sent.
3. **Password in the Partiful event details, with Guest Approval on (chosen).** Partiful only
   shows details to approved guests, so late RSVPs see it automatically. Cost: Jacky approves
   each guest; an approved guest who later says no still has the password.

## Design (as approved)
- Each event has a guest password like `DUMPLING-7Q4KX-M9P2B`: a word from the event's URL plus
  10 random-looking characters (the word is optional when typing), worked out by the Worker from HOST_KEY, the slug and a version
  number. Nothing is stored; nothing goes in the repo.
- Jacky pastes it into the Partiful event details along with a link that has it built in
  (`/events/<slug>/#p=DUMPLING-7Q4KX-M9P2B`). Typing it on the page works too.
- Host mode shows the password and a "copy for Partiful" button.
- Changing it: bump `password_version` in the event file, rebuild, push, update Partiful.
- Per-event switch `password: off` for open parties: then everyone sees names and can add, as before.

## Builder's calls (Claude)
- **Two secrets, not one.** The typed password is short, so the Worker rate-limits password
  tries (10 a minute per visitor) on a separate unlock route. A right password returns a long
  guest key (HMAC, unguessable), which the page keeps and sends on every read and write. Reads
  stay un-throttled because nobody can guess the long key.
- Edit tokens still work on their own: a guest who signed up can edit or remove their entry
  even if the password later changes.
- Initials: first letter of the first and last word ("Mei Lin" → "M.L.", "Mei" → "M.");
  non-letter starts are skipped; nothing usable → "Guest". Already-initials text is kept as is,
  so freezing is safe to repeat. One shared function used by the Worker and the build script.
- Freezing always stores initials, whatever the password setting.
- Icons: one SVG sprite (`assets/img/potluck.svg`) of six hand-drawn foods with little faces
  (pot, salad bowl, cake slice, boba, picnic basket, plate for "other"), tinted with each
  category's colour. Confetti keeps emoji.

## Independent review (2026-11-18), dispositions

A fresh reviewer read the diff. No way found for a stranger to get names or add entries.

| # | Finding | Disposition | Evidence |
|---|---------|-------------|----------|
| 1 | 6-char code brute-forceable from many IPv6 /64s | Fixed: 10 characters (30^10) | Worker test pins the format |
| 2 | Password changed when the title changed | Fixed: word comes from the slug; code alone also accepted | Fixture title differs from slug; code-only test |
| 3 | Locked-out guest could seed the edit form with initials and overwrite their name | Fixed: losing access cancels editing and hides Edit | Real-browser check: stale key while editing |
| 4 | New site + old Worker hides the form and erases the host key | Fixed in the page (missing fields mean "old Worker", not "no"); deploy and rollback order written in README | Code review; Worker deployed before site |
| 5 | A poll in flight could "reject" a just-entered host key | Fixed: host key changes bump the write counter | Code review |
| 6 | Wrong host keys on reads unthrottled; HOST_KEY doubles as password secret | Throttled (test added). Kept one secret: HOST_KEY is 192 random bits; README says rotating it changes the passwords | Worker test |
| 7 | Guests on one Wi-Fi share the 10/min limit | Accepted, told Jacky | — |

Not automated: the page script has no browser test suite; its flows were checked by hand in Chrome
(lock card, wrong/right/code-only password, `#p=` link, sign-up, host mode wrong/right key, copy,
stale key while editing, freeze).
