-- Potluck sign-ups. Only a display name and what they're bringing; no contact details, no IPs.
CREATE TABLE signups (
  id          TEXT PRIMARY KEY,           -- random, public
  event       TEXT NOT NULL,              -- event slug, e.g. 2026-12-12-dumpling-night
  name        TEXT NOT NULL,              -- 1-40 chars
  dish        TEXT NOT NULL,              -- 1-80 chars
  category    TEXT,                       -- main | side | dessert | drinks | supplies | NULL
  token_hash  TEXT NOT NULL,              -- SHA-256 of the guest's edit token (the token itself lives only on their phone)
  created_at  INTEGER NOT NULL,           -- ms since epoch
  updated_at  INTEGER NOT NULL
);

CREATE INDEX signups_by_event ON signups (event, created_at);
