// PDF library: one library per server (so a rulebook is uploaded once and used in any campaign),
// with sharing set per campaign. Text is extracted once with pdf.js and kept on disk for search.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { analyseScenario, SCENARIO_VERSION } from './scenario.js';

const require = createRequire(import.meta.url);
const MAX_RESULTS = 150;

let pdfjsPromise = null;
function pdfjs() {
  // legacy build is the one pdf.js supports in Node
  // pdf.js warns that it can't load a canvas package for rendering; we only read text, so hush that.
  pdfjsPromise ||= (async () => {
    const warn = console.warn, log = console.log;
    const quiet = (fn) => (...a) => (/napi-rs\/canvas|polyfill/.test(String(a[0])) ? undefined : fn(...a));
    console.warn = quiet(warn); console.log = quiet(log);
    try { return await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href); }
    finally { console.warn = warn; console.log = log; }
  })();
  return pdfjsPromise;
}

/** Lowercase, strip accents and smart quotes, collapse whitespace — used for both index and query. */
export function fold(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―−]/g, '-')
    .toLowerCase().replace(/\s+/g, ' ');
}

/** "laser pistol" damage → [{text:'damage'}, {text:'laser pistol', phrase:true}] */
export function parseQuery(q) {
  const terms = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(q || ''))) && terms.length < 12) {
    const t = fold(m[1] ?? m[2]).trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, (x) => (m[1] ? x : ''));
    if (t) terms.push(t);
  }
  return [...new Set(terms)];
}

function countOf(hay, needle) {
  let n = 0, i = hay.indexOf(needle);
  while (i !== -1 && n < 1000) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}

function snippet(text, folded, terms) {
  // fold() can change length for a few characters; fall back to the folded text in that case
  const src = text.length === folded.length ? text : folded;
  // anchor on the whole query if it appears as written, else on the rarest term (the distinctive one)
  let at = terms.length > 1 ? folded.indexOf(terms.join(' ')) : -1;
  if (at === -1) {
    let best = Infinity;
    for (const t of terms) {
      const i = folded.indexOf(t);
      if (i === -1) continue;
      const c = countOf(folded, t);
      if (c < best || (c === best && i < at)) { best = c; at = i; }
    }
  }
  if (at === -1) at = 0;
  const lineStart = src.lastIndexOf('\n', at) + 1;
  const start = at - lineStart <= 100 ? lineStart : Math.max(0, at - 70);
  const end = Math.min(src.length, at + 180);
  let s = src.slice(start, end);
  if (start > 0 && start !== lineStart) s = '…' + s.replace(/^\S*\s/, '');
  else if (start > 0) s = '…' + s;
  if (end < src.length) s = s.replace(/\s\S*$/, '') + '…';
  return s;
}

export class Library {
  constructor(dataDir, { onChange = () => {}, log = () => {} } = {}) {
    this.dir = path.join(dataDir, 'library');
    this.file = path.join(this.dir, 'library.json');
    this.onChange = onChange;
    this.log = log;
    fs.mkdirSync(this.dir, { recursive: true });
    try { this.docs = JSON.parse(fs.readFileSync(this.file, 'utf8')).docs || []; } catch { this.docs = []; }
    this.texts = new Map(); // id -> { pages: [text], folded: [text] } (loaded lazily)
    this.queue = Promise.resolve();
    // finish anything interrupted by a restart
    for (const d of this.docs) if (d.status === 'indexing' || d.status === 'queued') this.index(d.id);
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ docs: this.docs }, null, 1));
    fs.renameSync(tmp, this.file);
  }

  get(id) { return this.docs.find((d) => d.id === id); }
  pdfPath(doc) { return path.join(this.dir, `${doc.id}.pdf`); }
  scenarioPath(doc) { return path.join(this.dir, `${doc.id}.scenario.json`); }
  textPath(doc) { return path.join(this.dir, `${doc.id}.text.json`); }

  canSee(doc, room, viewer) {
    if (!doc) return false;
    if (viewer.isGM) return true;
    if (doc.status !== 'ready') return false;
    const s = doc.share?.[room];
    return s === 'all' || (Array.isArray(s) && s.includes(viewer.name));
  }

  /** What a viewer in a room is shown. GMs see everything plus each doc's sharing for this room. */
  listFor(room, viewer) {
    return this.docs.filter((d) => this.canSee(d, room, viewer)).map((d) => ({
      id: d.id, title: d.title, pages: d.pages, size: d.size, status: d.status, progress: d.progress,
      textPages: d.textPages, uploadedAt: d.uploadedAt, error: d.error,
      ...(viewer.isGM ? { share: d.share?.[room] ?? 'none' } : {}),
    }));
  }

  /** Adopt an uploaded file (already on disk at tmpPath). */
  add(tmpPath, originalName, size) {
    const id = crypto.randomBytes(8).toString('hex');
    const title = String(originalName || 'Untitled').replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 120) || 'Untitled';
    const doc = { id, title, size, pages: null, textPages: null, status: 'queued', progress: 0, uploadedAt: Date.now(), share: {} };
    fs.renameSync(tmpPath, this.pdfPath(doc));
    this.docs.push(doc);
    this.save();
    this.onChange();
    this.index(id);
    return doc;
  }

  update(id, room, patch) {
    const d = this.get(id);
    if (!d) throw new Error('No such document');
    if (typeof patch.title === 'string' && patch.title.trim()) d.title = patch.title.trim().slice(0, 120);
    if ('share' in patch) {
      const s = patch.share;
      d.share ||= {};
      if (s === 'all') d.share[room] = 'all';
      else if (Array.isArray(s) && s.length) d.share[room] = [...new Set(s.map((n) => String(n).slice(0, 32)).filter(Boolean))].slice(0, 50);
      else delete d.share[room];
    }
    this.save();
    this.onChange();
    return d;
  }

  remove(id) {
    const d = this.get(id);
    if (!d) throw new Error('No such document');
    d.deleted = true;
    this.docs = this.docs.filter((x) => x !== d);
    this.texts.delete(id);
    for (const f of [this.pdfPath(d), this.textPath(d), this.scenarioPath(d)]) fs.rm(f, { force: true }, () => {});
    this.save();
    this.onChange();
  }

  index(id) {
    const d = this.get(id);
    if (!d) return;
    d.status = 'queued';
    this.queue = this.queue.then(() => this.#extract(id)).catch(() => {});
    return this.queue;
  }

  async #extract(id) {
    const d = this.get(id);
    if (!d || d.deleted) return;
    d.status = 'indexing'; d.progress = 0; delete d.error;
    this.save(); this.onChange();
    let pdf;
    try {
      const { getDocument, VerbosityLevel } = await pdfjs();
      const pkg = path.dirname(require.resolve('pdfjs-dist/package.json'));
      const data = new Uint8Array(await fs.promises.readFile(this.pdfPath(d)));
      pdf = await getDocument({
        data, verbosity: VerbosityLevel.ERRORS, isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
        standardFontDataUrl: path.join(pkg, 'standard_fonts') + path.sep,
        cMapUrl: path.join(pkg, 'cmaps') + path.sep, cMapPacked: true,
      }).promise;
      d.pages = pdf.numPages;
      const pages = [];
      let lastTick = 0;
      for (let n = 1; n <= pdf.numPages; n++) {
        if (d.deleted) return;
        const page = await pdf.getPage(n);
        const tc = await page.getTextContent();
        let text = '';
        for (const item of tc.items) {
          if (!('str' in item)) continue;
          // re-join words hyphenated across a line break ("Mer-" + "chant")
          if (/\p{L}-\n?$/u.test(text) && /^[a-z]/.test(item.str)) text = text.replace(/-\n?$/, '');
          else if (text && !/\s$/.test(text) && item.str && !/^\s/.test(item.str)) text += ' ';
          text += item.str;
          if (item.hasEOL) text += '\n';
        }
        pages.push(text.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim());
        page.cleanup();
        if (Date.now() - lastTick > 400) {
          lastTick = Date.now();
          d.progress = n / pdf.numPages;
          this.onChange();
        }
        await new Promise((r) => setImmediate(r)); // keep the table responsive while big books index
      }
      await fs.promises.writeFile(this.textPath(d), JSON.stringify({ pages }));
      this.texts.set(id, { pages, folded: pages.map(fold) });
      d.textPages = pages.filter((p) => p.replace(/\s/g, '').length > 20).length;
      d.status = 'ready'; d.progress = 1;
      this.log(`  Indexed "${d.title}": ${d.pages} pages, ${d.textPages} with text`);
    } catch (e) {
      d.status = 'error';
      d.error = /password/i.test(e?.name + e?.message) ? 'This PDF is password-protected' : `Couldn't read this PDF (${e?.message || e})`;
    } finally {
      await pdf?.destroy?.().catch(() => {});
      if (!d.deleted) { this.save(); this.onChange(); }
    }
  }

  /** A saved scenario analysis, if there is a current one. */
  scenario(id) {
    const d = this.get(id);
    if (!d) return null;
    try {
      const r = JSON.parse(fs.readFileSync(this.scenarioPath(d), 'utf8'));
      return r.version === SCENARIO_VERSION ? r : null;
    } catch { return null; }
  }

  /** Work out a scenario's sections, read-aloud text, handouts and maps (see scenario.js). One at a time. */
  analyse(id, { onProgress } = {}) {
    const d = this.get(id);
    if (!d) return Promise.reject(new Error('No such document'));
    this.analysing ||= new Map();
    if (this.analysing.has(id)) return this.analysing.get(id);
    const job = (this.analyseQueue || Promise.resolve()).catch(() => {}).then(async () => {
      let pdf;
      try {
        const lib = await pdfjs();
        const pkg = path.dirname(require.resolve('pdfjs-dist/package.json'));
        pdf = await lib.getDocument({
          data: new Uint8Array(await fs.promises.readFile(this.pdfPath(d))),
          verbosity: lib.VerbosityLevel.ERRORS, isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
          fontExtraProperties: true, // gives us font names, so bold and italic text can be told apart
          standardFontDataUrl: path.join(pkg, 'standard_fonts') + path.sep,
          cMapUrl: path.join(pkg, 'cmaps') + path.sep, cMapPacked: true,
        }).promise;
        const result = await analyseScenario(pdf, lib, { title: d.title, onProgress });
        result.docId = id;
        result.analysedAt = Date.now();
        await fs.promises.writeFile(this.scenarioPath(d), JSON.stringify(result));
        this.log(`  Scenario prep for "${d.title}": ${result.sections.length} sections (${result.method}), ${result.handouts.length} handouts, ${result.maps.length} maps`);
        return result;
      } finally {
        await pdf?.destroy?.().catch(() => {});
        this.analysing.delete(id);
      }
    });
    this.analyseQueue = job;
    this.analysing.set(id, job);
    return job;
  }

  #text(d) {
    if (this.texts.has(d.id)) return this.texts.get(d.id);
    try {
      const { pages } = JSON.parse(fs.readFileSync(this.textPath(d), 'utf8'));
      const t = { pages, folded: pages.map(fold) };
      this.texts.set(d.id, t);
      return t;
    } catch { return null; }
  }

  /** Search the docs this viewer can see in this room (optionally one doc). */
  search(query, room, viewer, docId) {
    const terms = parseQuery(query);
    if (!terms.length) return { terms, results: [] };
    const results = [];
    for (const d of this.docs) {
      if (docId && d.id !== docId) continue;
      if (d.status !== 'ready' || !this.canSee(d, room, viewer)) continue;
      const t = this.#text(d);
      if (!t) continue;
      const titleHit = terms.every((x) => fold(d.title).includes(x));
      t.folded.forEach((f, i) => {
        let score = 0;
        for (const term of terms) {
          const c = countOf(f, term);
          if (!c) return;
          score += Math.min(c, 20) * (term.includes(' ') ? 3 : 1);
        }
        // headings and early mentions tend to be the useful page
        const first = f.indexOf(terms[0]);
        if (first !== -1 && first < 200) score += 2;
        if (titleHit) score += 1;
        results.push({ docId: d.id, title: d.title, page: i + 1, score, snippet: snippet(t.pages[i], f, terms) });
      });
    }
    results.sort((a, b) => b.score - a.score || (a.title === b.title ? a.page - b.page : a.title.localeCompare(b.title)));
    return { terms, results: results.slice(0, MAX_RESULTS), total: results.length };
  }
}
