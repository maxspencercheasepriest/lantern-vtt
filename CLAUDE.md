# Lantern VTT: notes for Claude

Read this first. It's the handover between sessions. The README is the user-facing manual. This file covers how the project fits together, how Flick likes to work, and what has been learned the hard way.

## What it is

A self-hosted virtual tabletop (a "Fantasy Grounds / Roll20 clone") built for **Flick** (the GitHub account is maxspencercheasepriest) to run games for friends. Repo: `maxspencercheasepriest/lantern-vtt`. Current version: **0.14.0** (in `package.json`).

How it runs:
- **Desktop app** (Electron): Windows NSIS installer, Mac DMGs (arm64 and x64), Linux AppImage. The GM picks **Host** (runs the server inside the app) or **Join**.
- **Plain Node server**: `npm start`. Players can join from any browser, including Safari.
- **Android tablet app** (Capacitor), companion only: it joins games and doesn't host them.

Flick runs it on **Intel Macs** as the GM: point them to the `-mac-x64.dmg` file, not arm64. The games are Call of Cthulhu, D&D 5e, Traveller, Tales from the Loop, Cyberpunk RED and Savage Worlds. Flick has GoDice smart dice and a GoDice Chrome extension of their own (its code lives in `public/js/lib/`).

## How Flick likes to work

- Wants features built end to end, then pushed to GitHub, with installers built.
- Plain, non-jargon explanations: Flick is technical (IT/infrastructure) but not a JS developer.
- Asks questions when a choice really matters, and otherwise expects Claude to get on with it.
- Sometimes says "don't implement yet": respect that.
- Tests on a real Mac, with friends joining through the share link (Safari works).
- After a build, give **direct artifact download links** (for the Mac: the `-mac-x64.dmg` inside the Mac artifact), because the Actions page hides artifacts while a run is still in progress.

## Feature map: where things live

**Server, at the repo root.** `server.js` exports `startServer(opts)`. It's embedded by Electron and also runs standalone. It uses Express and Socket.IO, and saves each campaign ("room") as JSON in `data/rooms/<id>.json`.

| Area | Server | Client (`public/js/`) |
|---|---|---|
| Scenes (unlimited; GM previews privately, then moves players) | `server.js`: `freshScene`, `sceneOf`, `scene:*` events; old single-`scene` saves are migrated to Scene 1 in `getRoom` | `scenes.js` (top scene bar, drop images to create scenes) |
| Map, tokens, grid, measure, ping, touch | `map:update`, `token:*` (`findToken` searches every scene) | `map.js` |
| Drawing (pen, line, arrow, rect, ellipse, text, eraser; GM-only notes; `playerDraw` per scene) | `draw:add/remove/clear` | `draw.js` |
| Fog per scene: `off` / `manual` / `sight` | `fog:op`, `fog:set`, `updateExplored()` | `map.js` (manual fog), `sight.js` |
| Walls, doors, line of sight, explored memory | `wall:*`, `door:toggle`; the server blocks player moves through walls | `sight.js`; geometry shared in `shared/vision.js` |
| Dice engine (kh/kl, `!`, `cp`, `swN`, `d100bN/pN`, `NdXsY` pools, pushes) | `shared/dice.js` (crypto rolls on the server) | `rolls.js` |
| GoDice (built-in d6 driver from Flick's extension; optional Particula library for other shells; Android native BLE) | — | `godice.js`, `lib/godice-ble.js`, `mobile/native-ble.js` |
| Rulesets and sheets: dnd5e, coc7, traveller, tftl, cpr, swade, generic | `campaign.js` (`RULESETS`, combat logic) | `systems.js`, `sheets.js` |
| Quick character generator for one-shots | — | `chargen.js` (pure, tested in Node) |
| Combat tracker (initiative per ruleset; SWADE card deck) | `campaign.js`, `combat:*` | `combat.js` |
| Story notes (Markdown subset, `[[links]]`, reveal to players) | `notes:*` | `notes.js`, `markdown.js` |
| Built-in rules (D&D SRD 5.1 under CC-BY-4.0, plus our own quick references) | `public/rules/` (built by `scripts/build-srd.js`) | `rules.js` |
| PDF library (upload, share, full-text search, handouts) | `library.js`, `/api/library` | `library.js` (also `loadDoc`, `renderRegion`) |
| Scenario prep (PDF → notes, read-aloud, handouts, maps; no AI) | `scenario.js` (`analysePages` is layout-only and testable), `Library.analyse` caches `<id>.scenario.json`; `library:analyse` + `scenario:progress/ready/error`; `GET /api/library/:id/scenario`; `notes:create-many` | `prep.js` (Prep button in Library → PDFs) |
| Video calls (WebRTC mesh; server only relays signalling) and the relay setting: free Open Relay via shared-secret TURN creds made per join (default), custom, or off; saved in `DATA_DIR/video.json`, `TURN_URL` env overrides | `av:*`, `video:settings`, `iceServersFor()` | `video.js` (stuck-link hints), Scene tab |
| Tokens from character sheets (drag a sheet onto the map, or 📍; players can place their own, once per scene) | `token:from-sheet` | `sheets.js`, `map.js` `placeSheet` |
| Chat sounds (dice and pen, synthesised; no audio files) | — | `sounds.js` |
| GM audio player (music playlist, layered ambience, effects; server clock keeps everyone in sync) | `soundboard.js`, `/api/audio`, `audio:*` | `audio.js` |
| Share online (Cloudflare quick tunnel, downloaded on first use) and Tailscale detection | `tunnel.js`; `electron/main.js` `share:*` | `share.js`, the launcher |
| Address handling (invite links, LAN/Tailscale = http on port 3000, domains = https) | `shared/address.js` | the launcher, `mobile/app-shell.js` |
| Props (interactive in-world HTML screens). Served at `/p/<propKey>/<collection>/<file>` with a CSP sandbox (opaque origin) and an injected helper (`props.js` `helperSource`) that swaps `localStorage` for the room's shared state (POST `__lantern/state`, live via SSE `__lantern/events`; pages that don't listen for `storage` reload) and adds `window.lantern` (me/roll/chat/sheet). Shares per collection in `room.propShares`, state in `room.propState`; prop keys are HMACs of room+name+GM in `propKeys` | `props.js` (`Props` collections, zip upload via fflate, path safety, `injectHelper`), server.js `/p/…`, `/api/props`, `prop:show/unshare/reset/delete` | `propsui.js` (Library → Props, prop windows, Show… menu, chat card) |
| Thaw props (built-in collection `thaw`): Cyberpunk RED pages in `public/handouts/thaw/`, also served plain at `/handouts/thaw/` | — | sources, builds and tests in `props/thaw/` |

Other code:
- **Electron** (`electron/`): the launcher (Host/Join), a custom Bluetooth picker for GoDice, camera and microphone permissions, a one-time relaunch to trust joined `http://` addresses (so Web Bluetooth works on them), and the tunnel. `build/after-pack.cjs` stamps the Windows exe and ad-hoc signs the Mac app.
- **Android** (`mobile/`, `capacitor.config.json`): `npm run mobile:sync` copies `public` into `mobile/www`, injects `app-shell.js` and `native-ble.js`, then runs `cap sync`. Uses `androidScheme: 'http'` (so http://localhost counts as secure) and `allowMixedContent`. The server's CORS allowlist covers the app's origins.

## Conventions

- Plain ES modules, with no framework and no bundler, except esbuild for `native-ble.js` only.
- UI text is in **British English**, short and friendly; error messages tell the user what to do next.
- Every client→server event goes through the `guard` or `gmOnly` wrapper. Sanitise all input with the helpers (`str`, `num`, `okColor`, `cleanToken`, …). Players never get hidden tokens or GM-only drawings.
- After changing state: `sendScene(room)` / `sendSceneList(room)` / `sendAudio(room)`, then `save(room)`. Saves are debounced, and `persisted()` lists exactly what gets saved.
- New root-level server files must be added to `build.files` in `package.json`, otherwise the desktop app breaks. Current list: server, library, campaign, tunnel, soundboard, scenario, props, plus `shared/**`, `public/**` and `electron/**`.
- Socket calls from the browser time out after 8 s (`call()` in util.js). Long jobs ack straight away, report progress by event, and serve results over HTTP (see scenario prep).
- Bump the version in **both** `package.json` and `package-lock.json` (the two version fields at the top). The Android versionCode is derived from the version.
- Commit messages end with the Co-Authored-By and Claude-Session lines given by the system reminder.

## Testing

- `npm test` runs Node's test runner over `test/*.test.js` plus `traveller-rules.test.cjs`. That's 47 tests: dice, campaign, library, chargen, soundboard, vision, address, scenario, and a server test that boots the real server on port 3999.
- **Browser end-to-end tests** use Python Playwright against a server started by hand, e.g. `PORT=3714 DATA_DIR=<scratch> GM_PASSWORD=gm node server.js`. Chromium comes pre-installed: don't run `playwright install`. Use one GM page plus one or more player pages, then check screenshots by reading the PNGs.
  - `window.__lanternSocket` (from app.js) and `window.__lantern_view()` (from map.js) are hooks for tests.
  - Turn world coordinates into screen coordinates with the view. Avoid clicking near the top of the map, where the scene bar and toolbar sit.
  - Expected console noise in tests: Google Fonts blocked (`ERR_TUNNEL_CONNECTION_FAILED`), and a 404 for `/vendor/godice.js` (the optional Particula library).
- Stop servers with a pattern that won't match your own shell: `pkill -f "[n]ode server.js"`.

## Builds and releases

- `.github/workflows/build.yml` has these jobs:
  - test
  - desktop: windows-latest NSIS; **macos-15-intel building both `--x64 --arm64`**; ubuntu AppImage
  - android: ubuntu-24.04 with its preinstalled SDK. It's debug-signed unless the `ANDROID_KEYSTORE_*` secrets are set.
  - release: runs only on `v*` tags
- Apple-silicon runners (`macos-latest`) kept going unacquired, which is why both Macs build on Intel.
- Trigger a build with `gh workflow run build.yml --ref main`. Watch it with `gh run watch <id>`. Get links with `gh api repos/maxspencercheasepriest/lantern-vtt/actions/runs/<id>/artifacts`, formatted as `https://github.com/maxspencercheasepriest/lantern-vtt/actions/runs/<run>/artifacts/<id>`.
- **This sandbox can't push tags or create releases** (403). Pushing to `main`, starting workflows and re-running jobs all work. To publish a GitHub Release, Flick runs `git tag vX.Y.Z && git push origin vX.Y.Z` on their own machine.
- The sandbox also can't reach Cloudflare (tunnels), Google Fonts, or most websites. GitHub and the package registries work.

## Licensing rules (keep to them)

- **D&D**: SRD 5.1 under CC-BY-4.0 only, with attribution in `public/rules/dnd5e/LICENSE.txt`.
- **Call of Cthulhu, Tales from the Loop, Traveller, Cyberpunk RED**: our own short quick references and mechanics only. Never copy their rulebook text. Players add their own PDFs to the Library.
- **Savage Worlds**: Pinnacle says it is *not* openly licensed, so mechanics only, with no rules text.
- **Particula's GoDice library** may not be redistributed. It's downloaded on demand (`npm run get-godice` or the launcher).
- **cloudflared** is Apache-2.0 and downloaded on demand.
- Never draw or bundle copyrighted characters or art. The chargen name and hook lists are original.

## Backlog

- Scenario prep (0.12.0) is only tested on generated PDFs (`test/fixtures/scenario-*.pdf`); real publisher PDFs (Chaosium etc.) will need tuning. Ask Flick what it found on a real book. Not yet detected: boxed read-aloud text in a plain font (shaded boxes), two-column reading-order quirks. An AI version (Claude API with Flick's own key) was offered as a later option.
- Props: per-player (rather than shared) storage isn't supported; everything a prop saves is shared per campaign. GoDice rolls from props (`lantern.roll` is digital only) and GM→prop messages are possible next steps. The deck's `scan` command tries `props.json`/directory listings, which 404 under `/p/`.
- Light sources and darkness per token. At the moment there's only a sight range per scene.
- The free video relay (Open Relay, `staticauth.openrelay.metered.ca`, secret `openrelayprojectsecret`) couldn't be reached from the sandbox, so it's untested end to end. Flick saw a 4G player stuck on "connecting" before it existed; ask whether video now connects on mobile data. If not, suggest a free Metered or Cloudflare account under "My own relay".
- Fog "by hand": the server already accepts polygon/freehand reveals (`fog:op` with `poly`), but there's no UI for them yet.
- Not yet tested on real hardware: GoDice in the Android app, and the reconnect behaviour with real dice. Flick reported dice dropping out; 0.8.1 added endless reconnects, a connection log and battery warnings. Ask what the Dice → Connection log shows.
