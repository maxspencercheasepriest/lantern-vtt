# Lantern VTT

A small, self-hosted virtual tabletop: a shared map with tokens and fog of war, a dice roller, character sheets, a **searchable PDF library** you share with your players, and **GoDice** smart-dice support built in.

- **Map** – upload any image, line up a grid, drag tokens around (they snap), measure distances, ping spots. The GM gets reveal/cover fog tools and hidden tokens.
- **Dice** – server-side secure rolls, with exploding dice, keep-highest/lowest, Cyberpunk RED crits/fumbles and Savage Worlds wild dice. Rolls can go to everyone or to the GM only.
- **Character sheets** – Traveller, Cyberpunk RED, Savage Worlds and a generic sheet. Every stat, skill and weapon has a roll button. Sheets can be linked to tokens, which then show a health bar.
- **PDF library** – upload rulebooks, adventures and handouts, choose who can read each one, and search them all at once. Players read them in a built-in viewer. The GM can show a page, or just part of one, to the whole table, or turn it into the battle map.
- **GoDice** – connect your dice over Bluetooth. Every roll button then waits for your physical dice. Explosions and crits ask for the extra die. You can also just roll loose dice and they appear in chat.

No database and no build step. State is saved as JSON files in `data/`.

There are two ways to run it: the **Windows desktop app** (Host / Join, like Fantasy Grounds), or a **plain Node server** that people open in a browser.

---

## Desktop app (Windows)

Run `Lantern-VTT-Setup-x.y.z.exe`. It installs per-user, so no admin rights are needed, and adds Start-menu and desktop shortcuts. The installer isn't code-signed, so Windows SmartScreen will warn the first time: choose **More info → Run anyway**.

### Hosting (GM)

1. Enter your name, a campaign name and a GM password, then press **Start hosting**.
2. Lantern runs the server inside the app and opens the table, with you joined as GM.
3. The launcher shows the addresses players on your network can use (e.g. `192.168.1.20:3000`). *Game → Hosting info* shows them again.
4. For players over the internet:
   - Forward the TCP port (3000 by default) on your router to your PC.
   - Give them your public IP followed by the port. The launcher's *find it* link looks up your public IP.
   - When Windows asks about the firewall the first time, allow Lantern.
5. Campaigns and the PDF library are saved in `%APPDATA%\Lantern VTT\campaigns`. Back up that folder.

### Joining (players)

1. Enter your name, the campaign name and the GM's address, then press **Join**.
2. The first time you use a new address, Lantern restarts once. That marks the address as trusted so GoDice can connect without HTTPS.

Players without the app can still join from Chrome or Edge at `http://<address>/?room=<campaign>`, but browser players need HTTPS for GoDice.

### GoDice in the app

d6 GoDice work straight away: at the table, **Connect a die** opens Lantern's own Bluetooth picker. Roll the die to wake it, then pick it from the list.

For other shells (d4, d8, d10, d12, d20), press **Download** under *Extra shells* in the launcher, then pick **Particula · all shells** at the table under Dice → GoDice.

### Building the installer yourself

```bash
npm install
npm run desktop   # run the app from source
npm run dist      # build dist/Lantern-VTT-Setup-<version>.exe
```

Build on Windows for the least fuss. Building on Linux works, but needs Wine with 32-bit support for the NSIS step.

---

## Quick start (Node server)

You need **Node.js 18 or newer**.

```bash
npm install
npm run get-godice      # optional — downloads the official GoDice library (see below)
npm start
```

Open http://localhost:3000. Choose a room name (e.g. `thaw`) and your name, then enter.

**GM password.** On first start, Lantern generates one, prints it in the console and saves it to `data/gm-password.txt`. To choose your own, set `GM_PASSWORD`:

```powershell
# Windows PowerShell
$env:GM_PASSWORD = "something-long"; npm start
```
```bash
# Linux / macOS
GM_PASSWORD=something-long npm start
```

Players join with just a room name and their own name. Send them a link like `https://your-host/?room=thaw`.

| Setting | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `HOST` | `0.0.0.0` | Use `127.0.0.1` when running behind a reverse proxy |
| `GM_PASSWORD` | generated | |
| `DATA_DIR` | `./data` | Rooms (`rooms/*.json`), uploaded images (`uploads/`) and the PDF library (`library/`) |
| `LIBRARY_MAX_MB` | `1024` | Largest PDF the GM can upload |

---

## GoDice

Lantern's default GoDice driver is the Web Bluetooth client from Flick's *GoDice for Roll20* extension (`public/js/lib/godice-ble.js`). It's bundled, reads standard **d6** GoDice, and needs nothing installed. The same extension also supplies the Traveller rules (`traveller.js`: characteristic DMs, specialities, Jack-of-all-Trades, effect tiers) and the attack flavour lines (`flavour.js` — edit or add lines freely).

Particula's official library is only needed for the **other shells** (d4, d8, d10, d12, d20, d%). Choose the driver under Dice → GoDice.

### 1. Install the Particula library (other shells only)

```bash
npm run get-godice
```

This downloads Particula's official [GoDice JavaScript API](https://github.com/ParticulaCode/GoDiceJavaScriptAPI) into `public/vendor/godice.js`. It isn't bundled with Lantern because its licence doesn't allow redistribution. By downloading it you accept Particula's licence, which covers **personal, non-commercial use**. That's fine for your own group, but it rules out running Lantern as a public or commercial service with GoDice enabled.

### 2. Browser requirements

GoDice connects through **Web Bluetooth**. That means:

- **Chrome or Edge** on Windows, macOS, Linux, Android or ChromeOS. Firefox and Safari don't support it, and iPhones/iPads can't connect at all.
- A **secure page**. `http://localhost` counts. Anyone connecting from another machine needs Lantern served over **HTTPS** (see *Hosting* below).

Only the person whose dice are connected needs this. Everyone else can use any browser.

### 3. Connect and set shells

1. In the **Dice** tab, click **Connect a die**. Roll the die once first to wake it up.
2. Pick it in the browser's Bluetooth dialog. It flashes blue when connected.
3. With the Particula driver, set each die's **shell** (D6, D20, D10, D10X, D4, D8 or D12) to match the one fitted. Lantern remembers this per die. The built-in driver always reads d6.
4. Click a die's coloured dot to flash it, which helps you tell identical dice apart.

### 4. Roll

Switch **Roll with** to **GoDice**. Every roll button and quick roll then opens a tray showing the dice it needs:

- Roll the matching dice. Each die flashes green when its result is accepted. Dice rolled together can land in any order.
- **Explosions** (Savage Worlds aces, `!`) and **Cyberpunk RED crits/fumbles** ask for one more die.
- **d%** is a D10X (tens) plus a D10 (units).
- If a die is missing or misbehaving, type its value into the tray, press **Roll rest digitally**, or **Cancel**.
- Rolls are tagged *GoDice* in chat, or *GoDice + other* if some values were typed or rolled digitally.

Dice rolled when no check is waiting are posted as a loose roll, grouped if they land together. You can turn this off in the Dice tab. A d10 normally reads 0 as 10, and there's a checkbox if your game wants 0.

A die that lands tilted asks you to roll it again. Shaking a die without rolling it, or nudging it to another face, is ignored.

> Physical rolls are reported to the server by the player's browser, so unlike digital rolls they rely on trust. That's the same as rolling real dice at a real table.

---

## Hosting for remote players

Lantern speaks plain HTTP. For players outside your network, and for GoDice on any machine other than the host, put it behind HTTPS. Any of these work:

**Caddy** (easiest; gets a Let's Encrypt certificate automatically). Forward ports 80 and 443 to the host, point a DNS name at your IP, then use this `Caddyfile`:

```
vtt.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

**Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:3000` gives you an HTTPS address with no port forwarding.

**Tailscale**: share the machine on your tailnet, and use `tailscale serve` for an HTTPS name.

**IIS / nginx**: any reverse proxy works as long as it passes WebSocket upgrades through. On IIS that means ARR plus the WebSocket Protocol feature.

### Keeping it running

- **Windows service**: [NSSM](https://nssm.cc/) works well. Run `nssm install LanternVTT "C:\Program Files\nodejs\node.exe" "C:\lantern-vtt\server.js"`, set the app directory, then add `GM_PASSWORD` and `HOST` under *Environment*.
- **Docker**: `docker build -t lantern-vtt .` then `docker run -d -p 3000:3000 -v lantern-data:/app/data -e GM_PASSWORD=... lantern-vtt`. Run `npm run get-godice` before building if you want GoDice included in the image.
- **Linux**: a systemd unit running `node server.js`.

**Backups.** Everything lives in `data/`. Copy that folder and you have the lot.

---

## PDF library

Open the **Library** tab.

**Adding PDFs (GM).** Press *Add PDFs…* or drop files onto the tab. Lantern reads the text of every page so it can be searched; a 400-page book takes a few seconds. The library belongs to your server, not to one campaign, so each book only needs uploading once.

**Sharing.** Press ⚙ next to a PDF and choose who can read it in *this* campaign:
- Only me (GM) — the default.
- Everyone.
- Particular players, by name.

Players can only see, search and open the PDFs shared with them. Sharing is set separately for each campaign. The ⚙ dialog is also where you rename, re-index or delete a PDF.

**Searching.** Type in the box at the top of the Library tab to search every PDF you can see. Results show the book, page and a snippet with your words highlighted. Click one to open the book at that page with the words highlighted.
- All words must be on the same page.
- Use quotes for an exact phrase: `"jump drive"`.
- Case and accents don't matter.

**Reading.** The viewer is a floating window:
- ‹ › or the arrow keys turn pages; you can also type a page number.
- −, Fit and + set the zoom.
- *Contents* lists the PDF's bookmarks.
- *Search this PDF* lists matching pages down the side. Press Enter to jump to the next one.

**Showing things to the table (GM).**
- *Show page* sends the current page to every player. It pops up on their screens and stays in the chat log.
- *Select area* lets you drag a box around part of a page — an illustration, a ship plan, a single paragraph — then *Show to players* or *Use as map*.

Shown pages are sent as pictures, so players see only what you picked, not the rest of the book.

**Scanned PDFs.** These are flagged *No searchable text*. They can still be read and shown, but not searched. Run them through an OCR tool (for example Adobe Acrobat's *Recognize Text*, or `ocrmypdf`), then upload them again.

The upload limit is 1 GB per file. Change it with the `LIBRARY_MAX_MB` setting.

---

## Using it

### GM

- **Scene tab**
  - Upload a map, then use *Grid px* and the offsets until the grid lines up with the map's own grid.
  - Set what a square is worth: 1.5 m for Traveller, 2 m for Cyberpunk RED, 1″ = 2 yd for Savage Worlds.
  - Add tokens with a name, colour, image, size and owner.
- **Fog**
  - Turn on *Fog enabled*. The map starts fully covered.
  - Drag with **Reveal** (R) or **Cover** (H). *Undo fog* steps back.
  - You see fog at half strength; players see it solid.
- **Tokens**
  - Right-click or double-click a token to edit it: link a sheet, set who can move it, hide or lock it, change layer order.
  - Delete removes the selected token.
- **Sheets**: you can see and edit every sheet, and choose its owner.
- `/gr 1d20` rolls to the GM only. The *Rolls to GM only* checkbox does the same for every roll you make.

### Players

- Move the tokens you own.
- Double-click your token to open its sheet.
- Make your own sheets in the **Sheets** tab. Tick *Visible to everyone* to share one.

### Map controls

| | |
|---|---|
| Drag empty space, middle-drag, or Space + drag | Pan |
| Scroll wheel | Zoom |
| Shift while dropping a token | Don't snap to the grid |
| V / M / P | Move, Measure, Ping tools |
| Alt + click | Ping |

### Chat

| | |
|---|---|
| `/r 2d6+1 Pilot` | Roll, with an optional label |
| `/gr 1d20` | Roll to the GM only |
| `/w Name message` | Whisper (the GM also sees whispers) |

### Dice notation

| | |
|---|---|
| `2d6+1`, `d%` | Plain dice and modifiers |
| `4d6kh3`, `2d20kl1` | Keep highest / keep lowest (Traveller boon = `3d6kh2`) |
| `1d6!` | Exploding (aces) |
| `1d10cp` | Cyberpunk RED d10: on a 10 roll again and add, on a 1 roll again and subtract |
| `sw8` | Savage Worlds trait die d8 plus a d6 wild die, both acing, keep the higher |

### What the sheets do for you

- **Traveller**
  - Characteristic DMs come from the current values, so damage lowers them.
  - Difficulty is shown as Effect on every roll.
  - Boon and Bane options.
  - Attacks use the linked skill (−3 if unskilled).
  - Token health bar shows STR + DEX + END.
- **Cyberpunk RED**
  - Skill base is shown as STAT + level.
  - Rolls use crit/fumble d10s.
  - −2 is applied automatically when seriously wounded.
  - *Spend luck* adds Luck to the next check and deducts it from your pool.
  - Optional DV shows beat or fail.
  - Damage rolls flag a Critical Injury on two or more 6s.
- **Savage Worlds**
  - Wild Card trait rolls with success and raise counts, and snake eyes.
  - Unskilled rolls are d4−2.
  - Wound and Fatigue penalties are applied automatically.
  - Parry and Toughness are calculated.
  - `Str+d6` damage is converted to dice, with every damage die acing, plus a raise button.
- **Generic**: free-form fields and named roll buttons.

---

## Development

```bash
npm test      # dice engine unit tests + a multi-client server test
```

Layout:

- `server.js` – Express, Socket.IO, permissions, persistence
- `shared/dice.js` – the dice engine, used by both server and browser
- `public/js/` – the browser app in plain ES modules (`map.js`, `sheets.js`, `systems.js`, `godice.js`, …)

To add a game system, add an entry to `public/js/systems.js`.

### Not done yet

- Dynamic lighting / line of sight
- Multiple scenes per room
- Drawing tools
- Initiative tracker
- Audio
