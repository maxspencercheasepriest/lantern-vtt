LANTERN SERVER
==============
Lantern, always on, on a computer at home. Everyone opens one address in their browser, logs in, and
picks a game from "My games" - like Roll20, but yours. Nobody needs to "host".

WINDOWS
  1. Unzip this somewhere permanent, e.g. C:\Lantern Server (not Downloads).
     (If you unzip it in Downloads, the installer offers to move it for you.)
  2. Double-click Install.cmd and say Yes to the administrator question.
     If Windows says it "protected your PC", choose More info, then Run anyway.
  3. Answer its questions: a GM password, the port (3000 is fine), and optionally your
     Cloudflare tunnel token (see YOUR OWN ADDRESS below). It installs the "Lantern Server"
     service, which starts with Windows and restarts itself if it ever stops.
  4. It opens http://localhost:3000. Type the GM password once and make your own account:
     you're the admin.

LINUX
  Unzip it to e.g. /opt/lantern-server, then:  sudo ./install.sh

YOUR OWN ADDRESS (e.g. https://lanternrpg.party)
  The domain needs to be on your Cloudflare account (buying it at Cloudflare does that).
  1. Cloudflare dashboard > Zero Trust > Networks > Tunnels > Create a tunnel.
  2. Choose "Cloudflared", name it "lantern", and copy the long token shown in the install
     command (everything after "service install").
  3. Under "Public hostname", add your domain (leave Subdomain blank for the bare domain),
     Service type HTTP, URL localhost:3000. Save.
  4. Run Install.cmd again and paste the token when it asks. (Or paste it the first time.)
  NO DOMAIN YET? Press Enter at the token question and say yes to a temporary address
  (https://something-random.trycloudflare.com). It changes whenever the server restarts;
  the current one is always under People > This server.
  Nothing needs opening on your router, your home address stays private, and it's HTTPS,
  so cameras, microphones and GoDice Bluetooth all work in the browser.

AFTER INSTALLING
  - My games: every campaign you're in. Start a new game, pick a ruleset, and you're its GM.
  - People (admins): accounts, passwords, "This server" (updates and backups), and
    "Bring campaigns in" - upload your desktop app's campaigns folder as a .zip.
  - Each game's "Players & invites" makes a link to send a player.

UPDATING
  People > This server > Check for updates > Update. It backs up, downloads the new version,
  restarts (about a minute; everyone reconnects by themselves). If a new version ever fails
  to start, the previous one is put back automatically.

WHERE THINGS ARE
  lantern.json   your settings (port, GM password). Administrators only.
  data\          campaigns, accounts, uploads and PDFs. data\backups\ has a copy of the
                 campaigns and accounts from each of the last 14 days.
  logs\          what the service has been doing, if something goes wrong.

UNINSTALL
  Uninstall.cmd (Linux: sudo ./uninstall.sh). Your campaigns stay in data\.
