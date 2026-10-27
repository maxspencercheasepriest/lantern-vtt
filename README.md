# Lantern VTT

A small, self-hosted virtual tabletop in the spirit of Fantasy Grounds. It has a shared map with tokens and fog of war, a dice roller, character sheets, a **combat tracker**, **story notes**, built-in **rules for each game system**, a **searchable PDF library** you share with your players, **video calls**, and **GoDice** smart-dice support. It runs on Windows, macOS and Linux, and players can join from an **Android tablet app**.

- **Map** – upload any image, line up a grid, drag tokens around (they snap), measure distances, ping spots. The GM gets reveal/cover fog tools and hidden tokens.
- **Dice** – server-side secure rolls, with exploding dice, keep-highest/lowest, Cyberpunk RED crits/fumbles and Savage Worlds wild dice. Rolls can go to everyone or to the GM only.
- **Rulesets** – pick the game per campaign: **D&D 5e**, **Traveller**, **Call of Cthulhu 7e**, **Tales from the Loop**, **Cyberpunk RED**, **Savage Worlds** or **Generic**. The ruleset sets the character sheets, how initiative works, the dice shortcuts and the built-in rules.
- **Character sheets** – one for each ruleset. Every stat, skill and weapon has a roll button. Sheets can be linked to tokens, which then show a health bar.
- **Combat tracker** – turn order using each game's own initiative, rounds, hit points, conditions that count down, and hidden NPCs. Players see only what they should, and the active token glows on the map.
- **Story notes** – the GM's adventure prep with read-aloud boxes, tables and links to other notes, PDF pages and rules. Notes stay private until you share or reveal them. Players can keep their own notes too.
- **Built-in rules** – the full **D&D 5e SRD** (monsters with rollable stat blocks, spells, conditions, magic items, equipment, rules). Monsters can be dropped straight into combat. The other rulesets have quick-reference pages.
- **PDF library** – upload rulebooks, adventures and handouts, choose who can read each one, and search them all at once. Players read them in a built-in viewer. The GM can show a page, or just part of one, to the whole table, or turn it into the battle map.
- **Video calls** – everyone at the table can join with camera and microphone. You get mute and camera buttons, device choice, a speaking indicator, and a dock beside or below the map.
- **GoDice** – connect your dice over Bluetooth. Every roll button then waits for your physical dice. Explosions and crits ask for the extra die. You can also just roll loose dice and they appear in chat.

No database and no build step. State is saved as JSON files in `data/`.

There are two ways to run it: the **desktop app** for Windows, Mac and Linux (Host / Join, like Fantasy Grounds), or a **plain Node server** that people open in a browser.

## Download

Installers are on the [Releases page](../../releases):

| | |
|---|---|
| Windows | `Lantern-VTT-Setup-x.y.z.exe` |
| Mac with Apple silicon (M1 and later) | `Lantern-VTT-x.y.z-mac-arm64.dmg` |
| Intel Mac (also runs on Apple silicon) | `Lantern-VTT-x.y.z-mac-x64.dmg` |
| Linux | `Lantern-VTT-x.y.z-linux-x86_64.AppImage` |
| Android tablet (joins games) | `Lantern-VTT-x.y.z-android.apk` |

They're built automatically by GitHub Actions (`.github/workflows/build.yml`) whenever a version tag such as `v0.7.0` is pushed. *Actions → Build installers → Run workflow* builds them too, without making a release. The files appear under *Artifacts* at the bottom of the run.

The apps aren't signed with a paid certificate, so the first launch needs one extra step:
- **Windows:** SmartScreen warns. Choose *More info → Run anyway*.
- **Mac:** open the app once and macOS blocks it. Go to *System Settings → Privacy & Security* and press **Open Anyway**. If macOS instead says the app "is damaged", run `xattr -dr com.apple.quarantine "/Applications/Lantern VTT.app"` in Terminal once.
- **Mac, when hosting:** allow incoming connections when macOS asks, so players can reach you.
- **Linux:** make the AppImage executable (`chmod +x`) and run it.
- **Android:** open the `.apk` on the tablet and allow installing apps from your browser or file manager when asked.


---

## Desktop app

**Windows:** `Lantern-VTT-Setup-x.y.z.exe` installs per-user, so no admin rights are needed, and adds Start-menu and desktop shortcuts. **Mac:** open the `.dmg` and drag Lantern VTT to Applications. Everything below works the same on both.

### Hosting (GM)

1. Enter your name, a campaign name and a GM password, then press **Start hosting**.
2. Lantern runs the server inside the app and opens the table, with you joined as GM.
3. The launcher shows the addresses players on your network can use (e.g. `192.168.1.20:3000`). *Game → Hosting info* shows them again.
4. For players over the internet:
   - Forward the TCP port (3000 by default) on your router to your PC.
   - Give them your public IP followed by the port. The launcher's *find it* link looks up your public IP.
   - When Windows asks about the firewall the first time, allow Lantern.
5. Campaigns and the PDF library are saved in `%APPDATA%\Lantern VTT\campaigns` on Windows, or `~/Library/Application Support/Lantern VTT/campaigns` on a Mac. Back up that folder.

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
npm run desktop     # run the app from source
npm run dist        # Windows installer  (dist/Lantern-VTT-Setup-<version>.exe)
npm run dist:mac    # Mac .dmg files      (must be run on a Mac)
npm run dist:linux  # Linux AppImage
```

The simplest way to get all three is to push a version tag and let GitHub Actions build them. Building the Windows installer on Linux works, but needs Wine with 32-bit support.

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
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | — | Optional TURN relay for video calls on awkward networks |

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

### If dice keep dropping out

Lantern keeps trying to reconnect a die for as long as the table is open, so a die that drops usually comes back on its own. Pick it up and roll it to wake it. Its row says *Reconnecting…* while that happens, and **Dice → Connection log** shows every connect, drop and retry, with the battery level at the time.

The usual causes:

- **Low battery.** Lantern warns at 15%. A die with a low battery often survives the connection, then drops on the first rolls, because rolling and flashing its lights draw the most power. Charge it fully and try again.
- **Still connected elsewhere.** Close the GoDice phone app, and any other browser tab or computer the die was connected to.
- **Range and interference.** Keep the dice within a couple of metres of the computer, with a clear path. Some laptops' built-in Bluetooth is weak; a cheap USB Bluetooth 5 adapter helps.
- **Windows power saving.** In Device Manager → Bluetooth → your adapter → Power Management, untick *Allow the computer to turn off this device to save power*.

> Physical rolls are reported to the server by the player's browser, so unlike digital rolls they rely on trust. That's the same as rolling real dice at a real table.

---

## Hosting for remote players

Players on your home network can always join with the address shown in the launcher. For players anywhere else, pick one of these.

### Share online (easiest)

Tick **Share online** in the launcher before **Start hosting**, or press **Scene → Players outside your network → Share online** at the table. A moment later you get a link like `https://brave-otter-lantern.trycloudflare.com/?room=thaw`. Press **Copy** and send it to your group.

- Players open the link in **Chrome or Edge**, or paste it into **Join** in the desktop app or the Android app, which also fills in the room.
- The link is **https**, so players' GoDice work in the browser too.
- Nothing to set up. No router port forwarding, no account.
- The first time, Lantern downloads Cloudflare's small open-source tunnel program, `cloudflared` (Apache-2.0), from Cloudflare's GitHub releases. The tunnel stops when you stop hosting or close Lantern.
- **The link changes every time you share.** Send the new one each session.
- **Anyone with the link can join as a player.** Only send it to your group. The GM password still protects GM powers.
- It runs on Cloudflare's free [quick tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/). They have no uptime guarantee and Cloudflare describes them as for testing. If one stops, Lantern tells you; share again for a new link.

Running the plain Node server instead of the app? Use `npm start -- --share`, or set `SHARE=1`. It prints the link.

### Tailscale (a private network for your group)

[Tailscale](https://tailscale.com/) is a free VPN that joins your group's devices into one private network. Nothing is open to the internet, and the address stays the same between sessions. It takes a little more setup, because every player installs it once.

1. You and each player install Tailscale (Windows, Mac, Linux, Android and iPhone) and sign in.
2. Add the players to your tailnet. In the Tailscale admin console, go to **Users → Invite users**. Or, for a lighter touch, **share** just your PC with each player from **Machines → Share**.
3. Host as normal. The launcher shows your **Tailscale address** (it starts `100.`) next to your home-network address.
4. Players join with that address, for example `100.101.2.3:3000`.

GoDice work over Tailscale in the desktop and Android apps. In a plain browser, Web Bluetooth needs https: run `tailscale serve 3000` on the host and give players the `https://….ts.net` address it prints.

### Your own domain

To serve Lantern from your own address, put it behind HTTPS. Any reverse proxy works as long as it passes WebSocket upgrades through.

**Caddy** is the easiest, because it gets a Let's Encrypt certificate automatically. Forward ports 80 and 443 to the host, point a DNS name at your IP, then use this `Caddyfile`:

```
vtt.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

On **IIS**, that means ARR plus the WebSocket Protocol feature. For a permanent address on Cloudflare, set up a [named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps) instead of a quick one.

### Keeping it running

- **Windows service**: [NSSM](https://nssm.cc/) works well. Run `nssm install LanternVTT "C:\Program Files\nodejs\node.exe" "C:\lantern-vtt\server.js"`, set the app directory, then add `GM_PASSWORD` and `HOST` under *Environment*.
- **Docker**: `docker build -t lantern-vtt .` then `docker run -d -p 3000:3000 -v lantern-data:/app/data -e GM_PASSWORD=... lantern-vtt`. Run `npm run get-godice` before building if you want GoDice included in the image.
- **Linux**: a systemd unit running `node server.js`.

**Backups.** Everything lives in `data/`. Copy that folder and you have the lot.

---

## Android app

The Android app lets players join a game from a tablet. It's a **companion**: the game is still hosted by the GM's desktop app or server. It's laid out for tablets. It runs on phones too, but the table is cramped there.

**Joining.** Enter the GM's address (the one their launcher shows, e.g. `192.168.1.20:3000`), the campaign name and your name. The app remembers the address. Everything works as on a computer:
- the map: drag to pan, pinch with two fingers to zoom, and long-press a token for its sheet
- sheets, dice and chat
- the combat tracker, notes, rules and PDFs
- video calls with the tablet's camera
- **GoDice** over the tablet's own Bluetooth, d6 dice only (see below)

**Why an app rather than the browser?**
- Android's Chrome only allows cameras and GoDice on secure (HTTPS) pages, and a home game is usually plain `http://`.
- The app carries Lantern's interface inside it, where the camera is allowed, and talks to the GM's server over the home network.
- It reaches GoDice through Android's own Bluetooth, which needs Android 7 or later and Bluetooth turned on.

**GoDice** in the app use the built-in driver, so they read standard d6 dice. Particula's library for other shells only works in desktop browsers and the desktop app.

**Versions.** The app and the GM's Lantern should be the same version. The app warns when they aren't.

**Updates and signing.** The APK from GitHub is *debug-signed* unless you give the build your own key. Each build is then signed differently, so to update you uninstall the old app first. You lose only the remembered address. To have updates install over the top instead:
1. Create a key once (Java's `keytool` comes with any JDK):
   `keytool -genkeypair -v -keystore lantern.keystore -alias lantern -keyalg RSA -keysize 2048 -validity 10000`
2. In the GitHub repository, go to *Settings → Secrets and variables → Actions* and add `ANDROID_KEYSTORE_BASE64` (the output of `base64 -w0 lantern.keystore`), `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS` (`lantern`).
3. Keep `lantern.keystore` and its password safe. Every future version must be signed with it.

**Building it yourself.**
- `npm run mobile:sync` copies Lantern's interface into the Android project (`mobile/android`).
- `npm run android` does that and opens the project in Android Studio.
- The native GoDice driver is `mobile/native-ble.js`, and the app start-up code is `mobile/app-shell.js`.

---

## Video calls

Press **Join video**, top right. Your browser or the app asks for the camera and microphone the first time. A dock of video tiles appears over the map:

| Control | Does |
|---|---|
| 🎤 | mute / unmute (**Ctrl/Cmd+D**) |
| 📷 | camera on / off (**Ctrl/Cmd+E**) |
| ⚙ | choose which camera and microphone |
| ⤢ | small / medium / large tiles |
| ⇆ | dock beside the map or along the bottom |
| ▾ | tuck the videos away (you stay in the call) |
| Click a tile | enlarge it |

The tile of whoever's talking lights up green. With no camera you join with sound only. A ● next to someone's name means they're in the call.

**How it works.** Audio and video go **directly between players** (WebRTC). The Lantern server only introduces them, so the host's upload isn't carrying everyone's video. Each person sends their video to every other person, which works well for a typical table of up to about six.

**Requirements.**
- Like GoDice, browsers only allow cameras on secure pages. The desktop app, `http://localhost`, or an HTTPS address all work. Plain `http://` addresses in a browser don't.
- Most home connections link up directly.

**Video relay.** Mobile data, hotspots and some home broadband block direct connections, so a player can see the table but their video stays on "connecting", then "can't connect". A relay passes their video along instead (still encrypted end to end). Choose one in **Scene → Video calls**:

- **Free relay** (the default): [Open Relay](https://metered.ca/tools/openrelay/), a free public relay. No sign-up; Lantern makes the logins itself. It's shared by everyone who uses it (about 20 GB a month), so for heavy use get your own.
- **My own relay**: a free account with [Metered](https://www.metered.ca/) or [Cloudflare](https://developers.cloudflare.com/realtime/), or your own coturn server. Enter its `turn:` address, username and password.
- **Off**: direct connections only.

The relay is only used when a direct link fails. After changing the setting, everyone in the call presses **Leave**, then **Join video**. Servers started with `TURN_URL=… TURN_USERNAME=… TURN_CREDENTIAL=… npm start` use that relay, and the setting can't be changed in the app.

---

## Music, ambience and sound effects

The **Audio** tab is the GM's soundboard. Everyone at the table hears it, in sync: someone joining halfway through a song starts at the same point as everyone else.

- **Add audio:** choose *as music*, *as ambience* or *as sound effects*, then **Choose files…**, or drop files onto the panel. MP3, OGG, M4A/AAC, WAV, FLAC, Opus and WebM work, up to 300 MB each (set `AUDIO_MAX_MB` to change). Files are stored with the campaign and sent to players' devices as they play, through the share link too.
- **Music** plays one track at a time as a playlist: ▶ on a track plays it, and the controls give pause, previous/next, stop, a position slider, shuffle, and a music volume for everyone. 🔁 repeats the playlist, 🔂 repeats one track, ➡️ plays the list once.
- **Ambience** tracks loop forever. Turn on as many as you like at once (rain, a fire and a distant crowd) and set each one's volume.
- **Sound effects** play once for everyone when you press 💥.
- Rename a track by editing its name, move it between music, ambience and effects with its menu, or delete it with ✕. **Stop all audio** silences everything.

Players see what's playing at the top of the Audio tab, with **their own volume and mute**, which only affects them. A ♪ on the tab shows that something is playing. If a browser won't play sound until the page has been clicked, players get a *click to listen* button.

Only use audio you have the rights to play to your group. Plenty of tabletop music and ambience is free for this (for example Tabletop Audio, or Kevin MacLeod's music under Creative Commons).

## Rulesets

The GM chooses the game when they first open a campaign. The desktop launcher can set it in advance. Change it at any time in the **Scene** tab. It decides:

| | D&D 5e | Traveller | Call of Cthulhu 7e | Tales from the Loop | Cyberpunk RED | Savage Worlds |
|---|---|---|---|---|---|---|
| Rolls | d20 with advantage/disadvantage, crits | 2D vs difficulty, Effect, boon/bane | d100 with success levels, bonus/penalty dice, pushing | d6 pool, 6s succeed, pushing | d10 + STAT + skill, crits/fumbles | Trait + Wild Die, aces, raises |
| Initiative | d20 + DEX | 2D + DEX/INT DM | DEX order | Cards 1–10, lowest first | d10 + REF | Action deck |
| Built-in rules | Full SRD 5.1 | Quick reference | Quick reference | Quick reference | Quick reference | Quick reference |

Any sheet type can still be used in any campaign. New sheets just default to the campaign's ruleset.

### What's built in, and why some systems only get a quick reference

Lantern only bundles rules text whose licence allows it:

- **D&D 5e:** the System Reference Document 5.1 is released by Wizards of the Coast under Creative Commons (CC-BY-4.0). It's all here, with attribution, in `public/rules/dnd5e/`, and you can regenerate it with `scripts/build-srd.js`.
- **Traveller, Call of Cthulhu and Tales from the Loop:** their books aren't openly licensed. Their publishers have released open *engines*: the Cepheus Engine SRD (OGL), Chaosium's Basic Roleplaying under ORC, and Free League's Year Zero Engine SRD. These come as PDFs. Download them from the publishers and drop them into the **Library**, where they become searchable alongside your own rulebooks.
- **Cyberpunk RED and Savage Worlds:** there's no openly licensed rules text (Pinnacle's fan licence covers fan-made material, not the rules), so these also get mechanics and a quick reference, and your PDFs go in the Library.
- **The quick-reference pages:** Lantern's own short summaries of how each game's mechanics work at the table. Mechanics aren't copyrightable, so the dice, sheets and initiative are all implemented for every system.

---

## Combat tracker

Open the **Combat** tab.

**Adding combatants (GM):**
- *+ Selected token* adds the token you last clicked, and *+ All tokens* adds everything on the map.
- Type a name to add someone without a token.
- In the D&D rules, a monster's stat block has *Add to combat* (optionally rolling hit points, several at once) and *Add with tokens*, which also places tokens on the map.
- Tokens linked to a sheet bring their initiative modifier along.

**Initiative** follows the ruleset:
- **Rolled** games: players roll their own with the **Roll** button, which works with GoDice, or from the sheet's initiative button. *Start combat* rolls for any NPCs still waiting.
- **Call of Cthulhu:** uses DEX.
- **Tales from the Loop and Savage Worlds:** cards are dealt every round. For Savage Worlds, a Joker is announced and the deck is reshuffled after that round.

**Running it:**
- *Next turn* moves on, and a new round is announced in chat. Players can end their own turn.
- Hit points: type a number and press **−** (damage) or **+** (heal). Temporary HP soaks damage first. An NPC's token health bar follows its tracker HP.
- Conditions: hover a row to add one, with an optional number of rounds. Timed conditions count down each round and are reported when they end.
- **●/◌** hides a combatant from players, and **PC/NPC** switches sides.

**What players see:** hidden combatants never appear, and NPC hit points show only as *Healthy / Hurt / Bloodied / Critical / Down*.

---

## Story notes

In the **Library** tab, choose **Notes**, then *+ New note*. Notes use simple formatting:

| You type | You get |
|---|---|
| `# Heading` | a heading |
| `**bold**`, `*italic*` | **bold**, *italic* |
| `> The door creaks open…` | a boxed read-aloud passage |
| `- item` / `1. item` | lists |
| `\| a \| b \|` + `\|---\|---\|` | a table |
| `[[The Old Mill]]` | a link to another note |
| `[[pdf:Core Rulebook#112]]` | a link to page 112 of a library PDF |
| `[[monster:Goblin]]`, `[[spell:Fireball]]`, `[[condition:Prone]]`, `[[item:Bag of Holding]]` | links into the D&D rules |
| `[[ref:Pushing]]` | a link to the campaign ruleset's quick reference |

Use *Folder* to group notes, such as *Act 1* or *NPCs*.

**GM notes** are private until you choose otherwise. *Share…* picks players. *Reveal to players* shares a note with everyone and posts it in chat.

**Players' notes** are private to them unless they share them with others.

The search box at the top of the Library tab searches **notes, rules and PDFs** at once.

---

## PDF library

Open the **Library** tab and choose **PDFs**.

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

### Scenario prep

Press **Prep** next to a scenario or campaign PDF in **Library → PDFs** (GM only). Lantern reads the book and offers:

- **Notes**: the book split into one note per part, chapter or section; you choose how fine. It uses the PDF's bookmarks if it has them, or its headings (bigger or bold text) if not. Tick the sections you want and click any of them to preview its note. Smaller sections fold into the note above them. Each note links back to its page, read-aloud text becomes a quote, and mentions of "Handout 3" link to the handout's page. A **contents note** links everything: sections, handouts, maps and read-aloud passages. All notes go in one folder and stay GM-only until you share them.
- **Read-aloud**: italic passages and paragraphs that start "Read aloud…", each with *Post to chat*.
- **Handouts**: headings like "Handout 1" or "Player Handout", with the picture on that page, plus pictures on "Papers & Clues" pages. **Show to players** pops one up on everyone's screen.
- **Maps**: big pictures on pages that mention a map or plan (and full-page pictures, marked "maybe"). **Make scene** turns one into a new scene, ready for its grid and walls.

Nothing is sent anywhere: it all happens on the computer running Lantern. Results are saved, so opening Prep again is instant; use *Analyse again* after re-uploading. Publishers lay books out very differently, so check what it found. Well-made PDFs with bookmarks and italic boxed text work best. Scanned PDFs with no text can't be read.

## Using it

### GM

- **Scenes** (the bar along the top of the map)
  - Make as many scenes as you like: **drop map images anywhere on the table** and each becomes a new scene named after its file. Or use *＋ Add maps*, or *Blank scene*.
  - Click a scene to look at it on your own; the players stay where they are. A banner says so, with **Move players here**. Double-clicking a scene also moves everyone there.
  - The green dot marks the players' scene. Hover a scene to rename (✎), duplicate (⧉) or delete (✕) it, and drag scenes to reorder them. *Scenes* on the left folds the bar away.
  - Each scene has its own map, grid, tokens, drawings, walls and fog.
- **Scene tab** (for the scene you're looking at)
  - Upload or replace its map, then use *Grid px* and the offsets until the grid lines up with the map's own grid.
  - Set what a square is worth: 1.5 m for Traveller, 2 m for Cyberpunk RED, 1″ = 2 yd for Savage Worlds.
  - Add tokens with a name, colour, image, size and owner.
- **Fog of war**: choose it per scene, in the toolbar's *Fog* menu or the Scene tab. You can switch it at any moment.
  - *Off*: players see the whole map.
  - *By hand*: the map starts covered. Drag with **Reveal** (R) or **Cover** (H); *Undo fog* steps back. You see fog at half strength; players see it solid.
  - *Line of sight*: players see only what their tokens can see (see below).
- **Tokens**
  - **Drag a character sheet from the Sheets tab onto the map** to place its token, or press its 📍. The token takes the sheet's name and portrait, is linked to the sheet (health bar included), and belongs to the sheet's player. Your own sheets become NPC tokens only you control.
  - Right-click or double-click a token to edit it: link a sheet, set who can move it, hide or lock it, change layer order.
  - Delete removes the selected token.
- **Tokens**
  - Right-click or double-click a token to edit it: link a sheet, set who can move it, hide or lock it, change layer order.
  - Delete removes the selected token.
- **Sheets**: you can see and edit every sheet, and choose its owner.
- `/gr 1d20` rolls to the GM only. The *Rolls to GM only* checkbox does the same for every roll you make.

### Line of sight, walls and doors

1. Set the scene's *Fog* to **Line of sight**.
2. Pick the **Walls** tool (W) and trace the map's walls. Click from point to point, or drag; each wall carries on from the end of the last one. Double-click, right-click or Esc stops. Ends snap to other walls and to grid corners and half-squares; hold Shift for no snapping.
3. Switch to **Door** for doorways. A door is a wall that opens. Clicking a door's marker with the Door tool locks or unlocks it. **Delete** removes a wall or door you click. *Undo* removes the last one.
4. Give each player a token they own (token menu → owner).

What players see:
- Everything their party's tokens can see, out to the walls. Areas they've seen before stay dimly visible; the rest is dark. Enemy tokens out of sight aren't shown.
- Anyone can open or close a door by clicking its marker, unless the GM has locked it (🔒).
- Players' tokens can't be dragged through walls or closed doors.
- **Sight range** (Scene tab) limits how far they see, in squares, for dark places and torchlight. 0 means as far as the walls allow.
- Untick **Party shares vision** if each player should only see through their own tokens.
- **Forget explored areas** wipes what the party remembers of the scene.

You see the whole map with the walls faintly drawn on top. **Player view** in the toolbar shows you what the players see.

### Drawing

The **Draw** tool (D), for everyone:
- Pen, line, arrow, rectangle, circle/ellipse and text, in any colour and size. Rectangles and circles can be filled.
- The eraser (⌫) removes drawings you click or drag over. Players can erase their own; the GM can erase anything.
- *Clear mine* removes your own drawings; the GM also has *Clear all*.

GM only:
- Tick **GM only** for private notes on the map that the players never see. They're marked with a small *GM* tag.
- Untick **Players can draw** to stop the players drawing on that scene.

### Players

- Place your own character: drag your sheet from the Sheets tab onto the map (or press 📍). One token per character per scene.
- Move the tokens you own.
- Double-click your token to open its sheet.
- Make your own sheets in the **Sheets** tab. Tick *Visible to everyone* to share one.

### Map controls

| | |
|---|---|
| Drag empty space, middle-drag, or Space + drag | Pan |
| Scroll wheel | Zoom |
| Shift while dropping a token | Don't snap to the grid |
| V / M / P / D | Move, Measure, Ping, Draw |
| W, R, H (GM) | Walls, Reveal, Cover |
| Click a door marker | Open or close it |
| Alt + click | Ping |

### Chat

| | |
|---|---|
| `/r 2d6+1 Pilot` | Roll, with an optional label |
| `/gr 1d20` | Roll to the GM only |
| `/w Name message` | Whisper (the GM also sees whispers) |

Chat has table sounds: dice clattering when anyone rolls, and a pen scratching on paper for messages. They're made in the browser, so there are no sound files. The speaker button under the chat log mutes them, and the slider sets the volume. Both are saved per player. Your own GoDice rolls stay quiet on your machine, because the real dice already made the noise; everyone else still hears them.

### Quick characters for one-shots

**Sheets → 🎲 Quick character** rolls up a ready-to-play character for any ruleset. Reroll until you like it, rename them, then **Create sheet**. With *Show the rolls in chat* ticked, the table sees what was rolled.

| Ruleset | How it's rolled |
|---|---|
| D&D 5e | 4d6 drop lowest ×6, with the best scores in the class's key abilities. Random SRD race, class and background, with level-1 HP, AC, saves, skills, attacks, spells and slots filled in. |
| Call of Cthulhu | 3d6×5 and (2d6+6)×5 characteristics, Luck, one EDU improvement check. A random occupation with EDU×4 occupation points and INT×2 interest points spread over its skills, plus a backstory. |
| Traveller | 2d6 characteristics (UPP), a career of 1–4 terms with matching age, skills, weapon and credits. |
| Tales from the Loop | Age 10–15, attribute points equal to age, Luck = 15 − age, 10 skill points weighted to the Type's key skills, plus an iconic item, Drive, Problem, Pride and Anchor. |
| Cyberpunk RED | 62 stat points (each 2–8) leaning on the role's stats, a role and role ability, extra skill levels, HP, Humanity and a weapon. |
| Savage Worlds | 5 attribute steps and 12 skill points (2 per step above the linked attribute), a concept, two Edges and one Major plus two Minor Hindrances. |
| Generic | 3d6 Body, Mind and Spirit with matching check rolls, plus a concept, trait and flaw. |

Occupations, careers, names and hooks come from short lists written for Lantern, so edit anything you like on the sheet afterwards.

### Dice notation

| | |
|---|---|
| `2d6+1`, `d%` | Plain dice and modifiers |
| `4d6kh3`, `2d20kl1` | Keep highest / keep lowest (Traveller boon = `3d6kh2`) |
| `1d6!` | Exploding (aces) |
| `1d10cp` | Cyberpunk RED d10: on a 10 roll again and add, on a 1 roll again and subtract |
| `sw8` | Savage Worlds trait die d8 plus a d6 wild die, both acing, keep the higher |
| `2d20kh1`, `2d20kl1` | D&D advantage / disadvantage (natural 20s and 1s are flagged) |
| `d100b1`, `d100p2` | Percentile with 1 bonus die / 2 penalty dice (extra tens dice; Call of Cthulhu) |
| `5d6s6` | Dice pool: count the dice showing 6 or more (Year Zero / Tales from the Loop) |

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
- **D&D 5e**
  - Ability checks, saves and skills, with proficiency and expertise worked out from your level.
  - A Normal / Advantage / Disadvantage switch.
  - Attacks with proficiency, to-hit and damage, plus a *Crit* button that doubles the dice.
  - Spell slots, spell save DC and spell attack. *Info* opens a spell in the SRD.
  - Death saves and hit dice.
- **Call of Cthulhu 7e**
  - Every characteristic and skill rolls d100 against its value, showing the success level and the ½ and ⅕ values.
  - Bonus/penalty dice, and a *Needs* setting for Hard or Extreme rolls.
  - **Push roll** appears on failed skill rolls.
  - Hit points, magic points, move, build and damage bonus are worked out for you. Write `DB` in weapon damage, e.g. `1d6+DB`.
  - Sanity and Luck rolls.
- **Tales from the Loop**
  - Attributes and skills build a d6 pool. Each Condition removes a die, and help, items or the Iconic Item add dice.
  - Choose how many successes the Trouble needs.
  - **Push roll** re-rolls everything that isn't a 6 and reminds you to mark a Condition.
- **Generic**: free-form fields and named roll buttons.

---

## Cyberpunk RED props (Thaw)

A set of in-fiction screens for the *Thaw* scenario — a laptop deck, a cryonics portal, a
news feed, a braindance editor, a gig board and the rest. They are plain HTML pages served
from `public/handouts/thaw/`, so with the server running they're at:

```
http://<your address>:3000/handouts/thaw/
```

Send a player the index link, or a link to a single page. They work on a phone or tablet, and
they also open straight off disk with no server at all. Most pages have a GM panel behind the
`gmgm` shortcut. Sources, build steps and tests for the two generated pages are in
`props/thaw/` — see `props/thaw/README.md`.

## Development

```bash
npm test      # dice engine, combat/notes rules, PDF library and multi-client server tests
```

Layout:

- `server.js` – Express, Socket.IO, permissions, persistence
- `campaign.js` – rulesets, combat tracker rules (initiative, turns, conditions) and notes
- `library.js` – PDF storage, text indexing and search
- `public/rules/` – the D&D 5e SRD data and the quick-reference pages
- `shared/dice.js` – the dice engine, used by both server and browser
- `public/js/` – the browser app in plain ES modules (`map.js`, `sheets.js`, `systems.js`, `godice.js`, …)
- `electron/` – the desktop app; `mobile/` and `capacitor.config.json` – the Android app
- `.github/workflows/build.yml` – builds every installer and the APK on GitHub

To add a game system, add an entry to `public/js/systems.js`.

### Not done yet

- Light sources (lanterns, torches) and darkness levels per token
- Boxed read-aloud text set in a plain font (only italic or labelled passages are found)
