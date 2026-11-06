// Bringing a Roll20 campaign in.
//
// Roll20 has no export of its own, so the file comes from the little extension
// in tools/roll20-export. This turns that file into Lantern's own shapes:
// pages become scenes, graphics become tokens, dynamic-lighting paths become
// walls, characters become sheets and handouts become notes.
//
// Everything here is pure except downloadImages(): the building is done against
// a map of image URL → uploaded path, so it can be tested without a network.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ROLL20_SQUARE = 70; // Roll20 draws one square as 70 pixels, always

const num = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const str = (v, max = 200) => (typeof v === 'string' ? v : '').slice(0, max);
const hex = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim().toLowerCase() : null);

/** Is this a usable picture link we could fetch? */
export const usableImage = (u) => typeof u === 'string' && /^https?:\/\//i.test(u) && !/^https?:\/\/\S*(marker|overlay)\/\S*$/i.test(u);

/** Roll20 keeps several sizes; ask for the big one. */
export function biggestImage(url) {
  if (typeof url !== 'string') return url;
  return url.replace(/\/(thumb|med|min)\.(png|jpg|jpeg|webp|gif)(\?|$)/i, '/max.$2$3');
}

// ---------------------------------------------------------------- html → text

// The Latin-1 names (160–255) in order, plus the handful of others that turn up
// in pasted text. Enough for handouts without pulling in a parser.
const LATIN1 = ('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 '
  + 'acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig '
  + 'Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash '
  + 'Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc '
  + 'euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml '
  + 'yacute thorn yuml').split(' ');
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", mdash: '—', ndash: '–', hellip: '…',
  rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', bull: '•', dagger: '†', trade: '™', euro: '€',
  ...Object.fromEntries(LATIN1.map((name, i) => [name, String.fromCodePoint(160 + i)])),
};
ENTITIES.nbsp = ' ';

/** Handout and bio text is HTML. Notes take a Markdown subset, so meet in the middle. */
export function htmlToText(html) {
  let s = String(html || '');
  if (!s) return '';
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, inner) => `\n\n${'#'.repeat(Math.min(3, +n))} ${inner.trim()}\n\n`);
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `\n- ${inner.trim()}`);
  s = s.replace(/<\/(ul|ol|p|div|tr|table|blockquote)>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/td>\s*<td[^>]*>/gi, ' | ');
  s = s.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner) => (inner.trim() ? `**${inner.trim()}**` : ''));
  s = s.replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner) => (inner.trim() ? `*${inner.trim()}*` : ''));
  s = s.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => `[${inner.trim() || href}](${href})`);
  s = s.replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, (_, src) => `\n![](${src})\n`);
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  s = s.replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? m);
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// ---------------------------------------------------------------- characters

const ABIL = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const DND_ABILITY = { STR: ['strength'], DEX: ['dexterity'], CON: ['constitution'], INT: ['intelligence'], WIS: ['wisdom'], CHA: ['charisma'] };
const COC_CHAR = {
  STR: ['strength', 'str'], CON: ['constitution', 'con'], SIZ: ['size', 'siz'], DEX: ['dexterity', 'dex'],
  APP: ['appearance', 'app'], INT: ['intelligence', 'int', 'idea'], POW: ['power', 'pow'], EDU: ['education', 'edu'],
};

/** Roll20 attribute lists are flat and case-happy; look one up by any of its names. */
function pick(byName, names) {
  for (const n of names) {
    const a = byName.get(String(n).toLowerCase());
    if (a) return a;
  }
  return null;
}
const val = (a, def = null) => (a && a.current !== '' && a.current != null ? a.current : def);

function sheetData(system, char, portrait, used) {
  const byName = new Map();
  for (const a of char.attribs || []) if (a && a.name) byName.set(String(a.name).toLowerCase(), a);
  const take = (names) => { const a = pick(byName, names); if (a) used.add(String(a.name).toLowerCase()); return a; };
  const n = (names, def) => { const a = take(names); const v = num(val(a, NaN), NaN); return Number.isFinite(v) ? v : def; };
  const t = (names, def = '') => { const a = take(names); const v = val(a, null); return v == null ? def : String(v).slice(0, 200); };

  const base = { name: str(char.name, 120) || 'Unnamed', portrait: portrait || null };

  if (system === 'dnd5e') {
    const hpAttr = take(['hp', 'hitpoints']);
    const d = {
      ...base,
      abilities: Object.fromEntries(ABIL.map((k) => [k, clamp(n(DND_ABILITY[k], 10), 1, 30)])),
      classLevel: t(['class'], '') || t(['character_class'], ''),
      level: clamp(n(['level'], 1), 1, 20),
      race: t(['race']), background: t(['background']), alignment: t(['alignment']),
      xp: clamp(n(['experience', 'xp'], 0), 0, 1e7),
      ac: clamp(n(['ac', 'armor_class', 'armorclass'], 10), 0, 60),
      speed: clamp(n(['speed'], 30), 0, 1000),
      hp: clamp(num(val(hpAttr, 10), 10), -999, 9999),
      hpMax: clamp(num(hpAttr?.max ?? n(['hp_max'], 10), 10), 0, 9999),
      initBonus: clamp(n(['initiative_bonus', 'initmod'], 0), -20, 20),
    };
    return d;
  }

  if (system === 'coc7') {
    const hpAttr = take(['hp', 'hitpoints']);
    const mpAttr = take(['magic', 'mp', 'magicpoints']);
    return {
      ...base,
      occupation: t(['occupation']), age: clamp(n(['age'], 30), 1, 120),
      residence: t(['residence']), birthplace: t(['birthplace']),
      chars: Object.fromEntries(Object.entries(COC_CHAR).map(([k, names]) => [k, clamp(n(names, 50), 0, 99)])),
      hp: clamp(num(val(hpAttr, 10), 10), 0, 99),
      mp: clamp(num(val(mpAttr, 10), 10), 0, 99),
      san: clamp(n(['sanity', 'san', 'sanity_points'], 50), 0, 99),
      luck: clamp(n(['luck', 'luckpoints'], 50), 0, 99),
    };
  }

  // Everything else keeps its numbers as a plain list, which is better than
  // guessing at a sheet layout we don't know.
  return base;
}

/** Attributes we didn't map, written out so nothing is silently lost. */
function leftovers(char, used) {
  const rows = (char.attribs || [])
    .filter((a) => a && a.name && !used.has(String(a.name).toLowerCase()))
    .filter((a) => String(a.current ?? '').trim() !== '' || String(a.max ?? '').trim() !== '')
    .map((a) => `- ${str(a.name, 60)}: ${str(String(a.current ?? ''), 120)}${a.max ? ` / ${str(String(a.max), 60)}` : ''}`);
  return rows;
}

// ---------------------------------------------------------------- images

/** Every picture the file refers to, deduplicated, biggest size asked for. */
export function imageUrls(data) {
  const out = new Set();
  for (const p of data.pages || []) {
    for (const g of p.graphics || []) if (usableImage(g.imgsrc)) out.add(biggestImage(g.imgsrc));
  }
  for (const c of data.characters || []) if (usableImage(c.avatar)) out.add(biggestImage(c.avatar));
  for (const h of data.handouts || []) if (usableImage(h.avatar)) out.add(biggestImage(h.avatar));
  return [...out];
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * Fetch the pictures into the uploads folder. Returns a Map of url → /uploads/…
 * Anything that won't come down is left out; the caller reports how many.
 */
export async function downloadImages(urls, uploadDir, { concurrency = 4, maxBytes = 30 * 1024 * 1024, onProgress, fetchImpl = fetch, signal } = {}) {
  const done = new Map();
  const failed = [];
  let i = 0, finished = 0;
  const workers = Array.from({ length: Math.min(concurrency, urls.length || 1) }, async () => {
    while (i < urls.length) {
      if (signal?.aborted) return;
      const url = urls[i++];
      try {
        const res = await fetchImpl(url, { redirect: 'follow', signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const ext = EXT[type];
        if (!ext) throw new Error(`not an image (${type || 'unknown type'})`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) throw new Error('empty');
        if (buf.length > maxBytes) throw new Error('too big');
        const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
        await fs.promises.writeFile(path.join(uploadDir, name), buf);
        done.set(url, `/uploads/${name}`);
      } catch (e) {
        failed.push({ url, why: e.message || String(e) });
      }
      onProgress?.(++finished, urls.length);
    }
  });
  await Promise.all(workers);
  return { images: done, failed };
}

// ---------------------------------------------------------------- the build

/** A Roll20 page becomes a scene; the biggest map-layer picture becomes its background. */
function buildScene(page, images, warn) {
  const square = ROLL20_SQUARE;
  const wide = clamp(Math.round(num(page.width, 25) * square), 100, 20000);
  const tall = clamp(Math.round(num(page.height, 25) * square), 100, 20000);

  const graphics = (page.graphics || []).filter((g) => g && !g.isdrawing);
  const mapLayer = graphics.filter((g) => g.layer === 'map' && usableImage(g.imgsrc));
  let background = null;
  if (mapLayer.length) {
    const biggest = mapLayer.reduce((a, b) => (num(a.width) * num(a.height) >= num(b.width) * num(b.height) ? a : b));
    background = images.get(biggestImage(biggest.imgsrc)) || null;
    if (background) mapLayer.splice(mapLayer.indexOf(biggest), 1);
  }

  const tokens = [];
  for (const g of graphics) {
    if (g.layer === 'walls') continue;                       // the lighting layer isn't scenery
    if (g.layer === 'map' && !mapLayer.includes(g)) continue; // that one became the background
    const w = num(g.width, square), h = num(g.height, square);
    const image = usableImage(g.imgsrc) ? images.get(biggestImage(g.imgsrc)) || null : null;
    if (!image && !str(g.name)) continue;                     // nothing to show and nothing to say
    const bar = g.bars?.[0];
    const cur = num(bar?.value, NaN), max = num(bar?.max, NaN);
    tokens.push({
      x: round(num(g.left) - w / 2), y: round(num(g.top) - h / 2),
      size: clamp(round(w / square), 0.25, 20),
      label: str(g.name, 40),
      color: hex(g.tint) || '#c0392b',
      image,
      hidden: g.layer === 'gmlayer',
      locked: g.layer === 'map',
      owners: [],
      sheetId: null,
      bar: Number.isFinite(cur) && Number.isFinite(max) && max > 0 ? { cur, max } : null,
      _represents: g.represents || '',   // joined up to a sheet later, then dropped
    });
  }

  const walls = [];
  let transparent = 0;
  for (const p of page.paths || []) {
    if (p.layer !== 'walls') continue;
    if (p.barrierType === 'transparent') { transparent++; continue; }
    const pts = Array.isArray(p.points) ? p.points : [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      const A = [round(num(a[0])), round(num(a[1]))], B = [round(num(b[0])), round(num(b[1]))];
      if (A[0] === B[0] && A[1] === B[1]) continue;
      walls.push({ a: A, b: B, kind: 'wall', open: false, locked: false });
    }
  }
  for (const d of page.doors || []) {
    const h0 = d?.path?.handle0, h1 = d?.path?.handle1;
    if (!h0 || !h1) continue;
    const A = [round(num(d.x) + num(h0.x)), round(num(d.y) + num(h0.y))];
    const B = [round(num(d.x) + num(h1.x)), round(num(d.y) + num(h1.y))];
    if (A[0] === B[0] && A[1] === B[1]) continue;
    walls.push({ a: A, b: B, kind: 'door', open: !!d.isOpen, locked: !!d.isLocked });
  }
  if (transparent) warn(`${transparent} see-through barrier${transparent === 1 ? '' : 's'} on "${page.name}" were left out — Lantern walls either block sight or aren't there`);
  if (walls.length > 5000) { warn(`"${page.name}" had more than 5000 wall segments; the rest were dropped`); walls.length = 5000; }

  const drawings = (page.paths || []).filter((p) => p.layer !== 'walls').length;
  if (drawings) warn(`${drawings} freehand drawing${drawings === 1 ? '' : 's'} on "${page.name}" weren't imported`);

  return {
    name: str(page.name, 60) || 'Map',
    map: {
      image: background,
      width: wide, height: tall,
      gridSize: square,
      offsetX: 0, offsetY: 0,
      showGrid: page.showgrid !== false,
      gridColor: hex(page.gridcolor) || '#000000',
      gridOpacity: clamp(num(page.grid_opacity, 0.3), 0, 1),
      unitsPerSquare: clamp(num(page.scale_number, 5), 0.1, 1000),
      unitName: str(page.scale_units, 8) || 'ft',
    },
    tokens,
    walls,
    fogMode: page.dynamicLighting ? 'sight' : 'off',
  };
}

/**
 * Turn an exported file into the pieces a campaign is made of.
 * `images` is a Map of url → /uploads/… ; anything missing simply has no picture.
 */
export function buildCampaign(data, { images = new Map(), system = 'generic', owner = '' } = {}) {
  if (!data || data.format !== 'lantern-roll20') throw new Error("That isn't a Lantern export of a Roll20 campaign.");
  const warnings = [];
  const warn = (w) => { if (warnings.length < 40 && !warnings.includes(w)) warnings.push(w); };

  const scenes = (data.pages || []).slice(0, 200).map((p) => buildScene(p, images, warn));
  if ((data.pages || []).length > 200) warn('only the first 200 maps were imported');

  const sheets = [];
  const sheetByCharId = new Map();
  for (const c of (data.characters || []).filter((c) => c && !c.archived)) {
    const used = new Set();
    const portrait = usableImage(c.avatar) ? images.get(biggestImage(c.avatar)) || null : null;
    const d = sheetData(system, c, portrait, used);
    const rest = leftovers(c, used);
    const bio = htmlToText(c.bio);
    const gm = htmlToText(c.gmnotes);
    d.notes = [
      bio,
      gm ? `**GM notes**\n\n${gm}` : '',
      rest.length ? `**From Roll20**\n\n${rest.join('\n')}` : '',
    ].filter(Boolean).join('\n\n').slice(0, 100_000);
    const sheet = { owner, shared: false, system, data: d, _roll20Id: c.id };
    sheets.push(sheet);
    if (c.id) sheetByCharId.set(c.id, sheet);
  }

  const notes = [];
  for (const h of (data.handouts || []).filter((h) => h && !h.archived)) {
    const body = htmlToText(h.notes);
    const gm = htmlToText(h.gmnotes);
    const shared = String(h.inplayerjournals || '').trim();
    notes.push({
      title: str(h.name, 120) || 'Handout',
      body: [body, gm ? `**GM notes**\n\n${gm}` : ''].filter(Boolean).join('\n\n').slice(0, 200_000),
      folder: 'Roll20',
      share: shared === 'all' ? 'all' : 'none',
      owner,
    });
  }

  const unmatched = [];
  for (const sc of scenes) {
    for (const t of sc.tokens) {
      const id = t._represents;
      delete t._represents;
      if (!id) continue;
      const sheet = sheetByCharId.get(id);
      if (sheet) sheet._tokenWants = true;
      else unmatched.push(id);
    }
  }
  if (unmatched.length) warn(`${unmatched.length} tokens pointed at characters that weren't in the file`);
  for (const s of sheets) delete s._tokenWants;

  return {
    scenes,
    sheets,
    notes,
    warnings,
    report: {
      campaign: str(data.campaign?.name, 80) || 'Roll20 campaign',
      scenes: scenes.length,
      tokens: scenes.reduce((n, s) => n + s.tokens.length, 0),
      walls: scenes.reduce((n, s) => n + s.walls.length, 0),
      sheets: sheets.length,
      notes: notes.length,
      backgrounds: scenes.filter((s) => s.map.image).length,
    },
  };
}
