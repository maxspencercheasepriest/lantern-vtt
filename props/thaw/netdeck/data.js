/* ───────────────────────────────────────────────────────────────────────────
   NETDECK — game data
   Black ICE stats and the architecture content tables follow Cyberpunk RED.
   Program stats are placeholders you can correct in the GM drawer.
   ─────────────────────────────────────────────────────────────────────────── */

const ICE = {
  Asp:        { cls:"Anti-Personnel", PER:4, SPD:6, ATK:2, DEF:2, REZ:15, cost:100,
                effect:"Destroys a single Program installed on the enemy Netrunner's Cyberdeck at random." },
  Giant:      { cls:"Anti-Personnel", PER:2, SPD:2, ATK:8, DEF:4, REZ:25, cost:1000,
                effect:"3d6 damage direct to the brain. The Netrunner is forcibly and unsafely Jacked Out, suffering the effect of every Rezzed Black ICE they've met in this Architecture on the way out (not the Giant)." },
  Hellhound:  { cls:"Anti-Personnel", PER:6, SPD:6, ATK:6, DEF:2, REZ:20, cost:500,
                effect:"2d6 damage direct to the brain. Unless insulated, their Cyberdeck and clothing catch fire: 2 HP at the end of each Turn until they spend a Meat Action putting themselves out. Does not stack." },
  Kraken:     { cls:"Anti-Personnel", PER:6, SPD:2, ATK:8, DEF:4, REZ:30, cost:1000,
                effect:"3d6 damage direct to the brain. Until the end of their next Turn they cannot go deeper or Jack Out safely (an unsafe Jack Out is still possible)." },
  Liche:      { cls:"Anti-Personnel", PER:8, SPD:2, ATK:6, DEF:2, REZ:25, cost:500,
                effect:"INT, REF and DEX each drop by 1d6 for an hour (minimum 1). Psychosomatic, no permanent effects." },
  Raven:      { cls:"Anti-Personnel", PER:6, SPD:4, ATK:4, DEF:2, REZ:15, cost:50,
                effect:"Derezzes one of the Netrunner's Rezzed Defender Programs at random, then deals 1d6 damage direct to the brain." },
  Scorpion:   { cls:"Anti-Personnel", PER:2, SPD:6, ATK:2, DEF:2, REZ:15, cost:100,
                effect:"MOVE drops by 1d6 for an hour (minimum 1). Psychosomatic, no permanent effects." },
  Skunk:      { cls:"Anti-Personnel", PER:2, SPD:4, ATK:4, DEF:2, REZ:10, cost:500,
                effect:"Until Derezzed, the affected Netrunner makes all Slide Checks at -2. One Netrunner at a time per Skunk, but multiple Skunks stack." },
  Wisp:       { cls:"Anti-Personnel", PER:4, SPD:4, ATK:4, DEF:2, REZ:15, cost:50,
                effect:"1d6 damage direct to the brain and lowers their total NET Actions next Turn by 1 (minimum 2)." },
  Dragon:     { cls:"Anti-Program",   PER:6, SPD:4, ATK:6, DEF:6, REZ:30, cost:1000,
                effect:"6d6 damage to a Program. If that would Derezz it, the Program is Destroyed instead." },
  Killer:     { cls:"Anti-Program",   PER:4, SPD:8, ATK:6, DEF:2, REZ:20, cost:500,
                effect:"4d6 damage to a Program. If that would Derezz it, the Program is Destroyed instead." },
  Sabertooth: { cls:"Anti-Program",   PER:8, SPD:6, ATK:6, DEF:2, REZ:25, cost:1000,
                effect:"6d6 damage to a Program. If that would Derezz it, the Program is Destroyed instead." },
};

/* NET Actions. The check is Interface + 1d10 vs the DV shown on the node. */
const NET_ACTIONS = [
  { id:"pathfinder", name:"Pathfinder", blurb:"Reveal what's on the floors ahead.", vs:"architecture" },
  { id:"backdoor",   name:"Backdoor",   blurb:"Defeat a Password.",                 vs:"password" },
  { id:"eyedee",     name:"Eye-Dee",    blurb:"Identify a File.",                   vs:"file" },
  { id:"virus",      name:"Virus",      blurb:"Alter or destroy a File.",           vs:"file" },
  { id:"control",    name:"Control",    blurb:"Seize a Control Node.",              vs:"control" },
  { id:"cloak",      name:"Cloak",      blurb:"Avoid being noticed.",               vs:"architecture" },
  { id:"slide",      name:"Slide",      blurb:"Break away from ICE.",               vs:"ice" },
  { id:"zap",        name:"Zap",        blurb:"Built-in attack. 1d6 to a target.",  vs:"ice" },
];

/* Programs. NAMES are right; NUMBERS are placeholders — set them from your book
   in the GM drawer (Programs tab). Kept in the book's stat shape. */
const PROGRAMS = [
  { id:"sword",     name:"Sword",             cls:"Attacker", ATK:3, DEF:0, REZ:7,  dmg:"3d6",
    effect:"Anti-Program attacker. Damages ICE and enemy Programs." },
  { id:"banhammer", name:"Banhammer",         cls:"Attacker", ATK:3, DEF:0, REZ:7,  dmg:"3d6",
    effect:"Anti-Personnel attacker. Damages enemy Netrunners directly." },
  { id:"hellbolt",  name:"Hellbolt",          cls:"Attacker", ATK:2, DEF:0, REZ:7,  dmg:"2d6",
    effect:"Anti-Personnel attacker. Sets the target's deck alight." },
  { id:"vrizzbolt", name:"Vrizzbolt",         cls:"Attacker", ATK:1, DEF:0, REZ:7,  dmg:"1d6",
    effect:"Anti-Personnel attacker. Reduces the target's NET Actions next Turn." },
  { id:"armor",     name:"Armor",             cls:"Defender", ATK:0, DEF:0, REZ:7,  dmg:"—",
    effect:"Reduces damage taken from ICE and enemy Programs." },
  { id:"flak",      name:"Flak",              cls:"Defender", ATK:0, DEF:4, REZ:7,  dmg:"—",
    effect:"Raises the DV of attacks made against you in the NET." },
  { id:"shield",    name:"Shield",            cls:"Defender", ATK:0, DEF:0, REZ:7,  dmg:"—",
    effect:"Absorbs damage until it is spent, then Derezzes." },
  { id:"eraser",    name:"Eraser",            cls:"Booster",  ATK:0, DEF:0, REZ:7,  dmg:"—",
    effect:"Bonus to Cloak — scrubs your traces as you go." },
  { id:"seeya",     name:"See Ya",            cls:"Booster",  ATK:0, DEF:0, REZ:7,  dmg:"—",
    effect:"Bonus to Slide — makes you slippery to ICE." },
  { id:"speedy",    name:"Speedy Gonzalvez",  cls:"Booster",  ATK:0, DEF:0, REZ:7,  dmg:"—",
    effect:"Bonus to Pathfinder — maps ahead faster." },
  { id:"worm",      name:"Worm",              cls:"Booster",  ATK:0, DEF:0, REZ:7,  dmg:"—",
    effect:"Bonus to Backdoor — chews through Passwords." },
  { id:"invis",     name:"Invisibility",      cls:"Booster",  ATK:0, DEF:0, REZ:7,  dmg:"—",
    effect:"Raises the DV for anything trying to detect you." },
];

/* Quickhacks — a 2077-flavoured layer, written so a RED GM can adjudicate them.
   Not from the rulebook. RAM is this app's own resource. */
const QUICKHACKS = [
  { id:"ping",      name:"Ping",               ram:1, cd:1, tone:"util",
    effect:"Every networked device and piece of cyberware within 30m lights up on the grid for one Turn. Reveals hidden enemies with chrome, cameras, and anything jacked into the local net." },
  { id:"optics",    name:"Reboot Optics",      ram:2, cd:2, tone:"ctrl",
    effect:"Target's Cyberoptics go dark. They are Blinded (-4 to all Actions requiring sight) until they spend an Action rebooting. No effect on a target running organic eyes." },
  { id:"short",     name:"Short Circuit",      ram:3, cd:2, tone:"dmg",
    effect:"2d6 damage direct, bypassing armour, as their own chrome arcs. Targets with no cyberware take 1d6 instead from the feedback through their Agent." },
  { id:"overheat",  name:"Overheat",           ram:2, cd:2, tone:"dmg",
    effect:"1d6 damage now and 1d6 at the end of each of their Turns until they spend a Meat Action venting. Their weapon is Unusable while it cooks." },
  { id:"glitch",    name:"Weapon Glitch",      ram:2, cd:1, tone:"ctrl",
    effect:"Target's smartgun link or power weapon jams. Their next Attack automatically misses and clearing it costs an Action." },
  { id:"malfunc",   name:"Cyberware Malfunction", ram:3, cd:3, tone:"ctrl",
    effect:"One piece of the target's cyberware seizes: cyberarm goes limp, cyberleg locks, cyberaudio screams. GM picks. Lasts until the end of the scene or a Tech spends a Turn on it." },
  { id:"contagion", name:"Contagion",          ram:4, cd:3, tone:"dmg",
    effect:"1d6 damage to the target and to everyone within 3m running cyberware, as the payload jumps between linked systems." },
  { id:"whistle",   name:"Whistle",            ram:2, cd:2, tone:"ctrl",
    effect:"Target's Agent shrieks. They move toward the source of the noise and lose any Cover benefit for a Turn while they look for it." },
  { id:"wipe",      name:"Memory Wipe",        ram:4, cd:4, tone:"util",
    effect:"Target forgets it saw you. It drops out of combat and returns to its patrol unless attacked again. Mooks only — a named NPC gets an INT check against your Interface + 1d10." },
  { id:"reset",     name:"System Reset",       ram:6, cd:4, tone:"dmg",
    effect:"Target's neural link hard-crashes. They are Unconscious. Against a target with a Neural Link and full borgware this is lethal — GM's call, and the crew's problem afterwards." },
];

/* Architecture generation — Cyberpunk RED content tables by difficulty tier. */
const TIERS = [
  { id:1, name:"Basic",    dv:6,  label:"DV6 · Interface 1–2" },
  { id:2, name:"Standard", dv:8,  label:"DV8 · Interface 3–4" },
  { id:3, name:"Uncommon", dv:10, label:"DV10 · Interface 5–6" },
  { id:4, name:"Advanced", dv:12, label:"DV12 · Interface 7+" },
];

const LOBBY_TABLE = ["File DV6", "Password DV6", "Password DV8", "Skunk", "Wisp", "Killer"];

const BODY_MATRIX = [
  // tier 1
  ["Hellhound","Sabertooth","Raven Raven","Hellhound","Wisp","Raven","Password DV6","File DV6",
   "Control Node DV6","Password DV6","Skunk","Asp","Scorpion","Killer Skunk","Wisp Wisp Wisp","Liche"],
  // tier 2
  ["Hellhound Hellhound","Hellhound Killer","Skunk Skunk","Sabertooth","Scorpion","Hellhound",
   "Password DV8","File DV8","Control Node DV8","Password DV8","Asp","Killer","Liche","Asp",
   "Raven Raven Raven","Liche Raven"],
  // tier 3
  ["Kraken","Hellhound Scorpion","Hellhound Killer","Raven Raven","Sabertooth","Hellhound",
   "Password DV10","File DV10","Control Node DV10","Password DV10","Killer","Liche","Dragon",
   "Asp Raven","Dragon Wisp","Giant"],
  // tier 4
  ["Hellhound Hellhound Hellhound","Asp Asp","Hellhound Liche","Wisp Wisp Wisp","Hellhound Sabertooth",
   "Kraken","Password DV12","File DV12","Control Node DV12","Password DV12","Giant","Dragon",
   "Killer Scorpion","Kraken","Raven Wisp Hellhound","Dragon Dragon"],
];

const CONTROL_NODES = ["Camera","Sprinkler","Siren","Conveyor Belt","Video Display Feed",
  "Chlorination Valve","Door Lock","Massage Chair","Soda Machine","Air Conditioning","Turret",
  "Blast Door","Coolant Pump","Lift Motor","PA System","Reserve Cell Relay"];

/* Architectures shipped with the app. */
const ARCHITECTURES = {
  depository7: {
    name: "DEPOSITORY 7",
    tier: 4,
    note: "Pre-war, air-gapped, mechanical outer seal. Nothing here has been patched since 2023.",
    floors: [
      { n:1, content:[{t:"password", dv:12, label:"Password DV12", detail:"Outer maintenance hatch"}] },
      { n:2, content:[{t:"ice", ice:"Hellhound"}, {t:"ice", ice:"Hellhound"}] },
      { n:3, content:[{t:"file", dv:12, label:"File DV12", detail:"Depository manifest — Schedule B"},
                      {t:"control", dv:12, label:"Control Node DV12", detail:"Blast Door"}] },
      { n:4, content:[{t:"ice", ice:"Kraken"}] },
      { n:5, content:[{t:"password", dv:12, label:"Password DV12", detail:"Inner vestibule"}] },
      { n:6, content:[{t:"ice", ice:"Dragon"}, {t:"ice", ice:"Dragon"}] },
      { n:7, content:[{t:"control", dv:12, label:"Control Node DV12", detail:"PERSEPHONE challenge — biometric"},
                      {t:"ice", ice:"Giant"}] },
    ],
  },
  lindqvist: {
    name: "LINDQVIST NC-1",
    tier: 1,
    note: "A dying clinic running on a reserve cell. Almost nothing is awake.",
    floors: [
      { n:1, content:[{t:"password", dv:6, label:"Password DV6", detail:"Staff portal"}] },
      { n:2, content:[{t:"file", dv:6, label:"File DV6", detail:"Patient registry"},
                      {t:"ice", ice:"Skunk"}] },
      { n:3, content:[{t:"control", dv:6, label:"Control Node DV6", detail:"Reserve Cell Relay"}] },
      { n:4, content:[{t:"password", dv:8, label:"Password DV8", detail:"Director tier"},
                      {t:"ice", ice:"Wisp"}] },
      { n:5, content:[{t:"file", dv:6, label:"File DV6", detail:"Bay 09 — sealed record"}] },
    ],
  },
};
