# Thaw — Cyberpunk RED props

The screens for **Thaw**: self-contained HTML pages the players actually hold. No server, no
network, no build step for most of them. They live in `public/handouts/thaw/`, so a running
Lantern server already serves them:

```
http://<your address>:3000/handouts/thaw/
```

Send a player that link, or one page's link, and it opens on a laptop, a tablet or a phone.
Opening the files straight off disk (`file://`) works too — handy if you want them on a
laptop at the table with no server running at all.

## What's there

| Page | What it is |
|---|---|
| `index.html` | The list, for handing out one link |
| `deck.html` | DECK/OS — the crew's laptop deck: shell, file system, launches the other props |
| `lindqvist-portal.html` | The cryonics facility's staff portal, with two locked tiers (**built** — see below) |
| `netdeck.html` | NET architectures, ICE, quickhacks and the trace (**built** — see below) |
| `news.html` | Dead Channel, the city's news feed |
| `bd.html` | The braindance editor: reels, layers, findings |
| `market.html` | Night Market — gear and prices |
| `gigs.html` | The gig board |
| `contacts.html` | Contacts and reputation |
| `ripper.html` | Chrome & Comfort, the ripperdoc |
| `security.html` | The building's own view of itself |

Most props have a GM panel behind the shortcut **`gmgm`** — type it on the page (not in a
text field) and the drawer opens. It is for the GM's eyes at the table, not a secret from a
determined player.

## The two built props

`lindqvist-portal.html` and `netdeck.html` are generated, so edit the sources here and
rebuild rather than editing the page in `public/`:

```bash
node props/thaw/portal/build.mjs     # → public/handouts/thaw/lindqvist-portal.html
node props/thaw/netdeck/build.mjs    # → public/handouts/thaw/netdeck.html
```

- **portal/** — `content.mjs` holds the credentials and the three tiers of content; `build.mjs`
  seals the staff and director tiers with PBKDF2 (250,000 rounds) and AES-GCM, so the locked
  material is genuinely encrypted inside the page and the password the players find is what
  opens it. The build refuses to write a file if any sealed plaintext leaks into it.
- **netdeck/** — `data.js` is the architectures and ICE; `build.mjs` folds it into `app.html`.

`content.mjs` and `data.js` are the answer key. This repo is public, so anyone who goes
looking can read the portal's passwords there. That only matters if your players are the
sort to go looking.

## Tests

Browser tests, one file per prop, run with Node and Playwright:

```bash
npm install --no-save playwright     # not a dependency of the VTT
node props/thaw/test/deck.test.mjs
```

They serve `public/handouts/thaw/` over a throwaway HTTP server and drive the real pages.

**Status, honestly:** `deck.test.mjs` passes, 39 of 39. The other six suites were written
against newer versions of the props than the copies in this commit, and fail where the two
have drifted apart — the portal test looks for a `#screen` element the current template
doesn't have, and four suites use a `scan` command this `deck.html` doesn't implement. The
props themselves work; it's the pairing that's stale. If you still have the newer `deck.html`
and portal template on your Mac, drop them in and most of these should go green again.

None of this runs in CI: `npm test` only picks up `test/*.test.js` at the repo root.
