// Scenario prep: read a scenario or campaign PDF and work out its structure, without any AI.
//   sections   from the PDF's bookmarks, or else from its headings (bigger or bold text)
//   readAloud  italic passages, and paragraphs that start "Read aloud…"
//   handouts   labelled "Handout 1…", "Player Handout…", with the picture on that page if there is one
//   maps       big images on pages that mention a map or plan (or full-page pictures)
// Every publisher lays books out differently, so the GM reviews all of this before anything is made.
import { fold } from './library.js';

export const SCENARIO_VERSION = 2;
const LIMITS = { sections: 600, readAloud: 400, handouts: 120, maps: 60 };

// ---------- reading pages ----------
const mul = (m, t) => [m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1], m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3], m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5]];

/** Images drawn on a page, as fractions of the page measured from the top left: { x, y, w, h, area }. */
function pageImages(ops, OPS, W, H) {
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const out = [];
  const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintJpegXObject, OPS.paintImageXObjectRepeat].filter((x) => x != null));
  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i];
    if (f === OPS.save) stack.push(ctm);
    else if (f === OPS.restore) ctm = stack.pop() || ctm;
    else if (f === OPS.transform) ctm = mul(ctm, ops.argsArray[i]);
    else if (paint.has(f)) {
      // the image is the unit square under the current transform
      const xs = [ctm[4], ctm[4] + ctm[0], ctm[4] + ctm[2], ctm[4] + ctm[0] + ctm[2]];
      const ys = [ctm[5], ctm[5] + ctm[1], ctm[5] + ctm[3], ctm[5] + ctm[1] + ctm[3]];
      const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(W, Math.max(...xs));
      const y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(H, Math.max(...ys));
      if (x1 - x0 < 8 || y1 - y0 < 8) continue;
      const r = { x: x0 / W, y: (H - y1) / H, w: (x1 - x0) / W, h: (y1 - y0) / H };
      r.area = r.w * r.h;
      out.push(r);
    }
  }
  return out;
}

/** Text items → lines: { text, x, y (from the top, in points), size, bold, italic } in reading order. */
function pageLines(items, fontOf, H) {
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const str = it.str.replace(/\s+/g, ' ');
    if (!str.trim()) { if (it.hasEOL && cur) cur.eol = true; continue; }
    const t = it.transform;
    const size = Math.hypot(t[2], t[3]) || Math.abs(t[3]) || 10;
    const x = t[4], y = H - t[5];
    const font = fontOf(it.fontName);
    const bold = /bold|black|heavy|semibold|demi/i.test(font);
    const italic = /italic|oblique/i.test(font);
    const sameLine = cur && !cur.eol && Math.abs(y - cur.y) <= Math.max(size, cur.size) * 0.45 && x >= cur.x1 - size * 2;
    if (!sameLine) {
      cur = { text: '', x, x1: x, y, size, chars: 0, boldChars: 0, italicChars: 0 };
      lines.push(cur);
    }
    const gap = x - cur.x1;
    if (cur.text && gap > size * 0.18 && !/\s$/.test(cur.text) && !/^\s/.test(str)) cur.text += ' ';
    cur.text += str;
    cur.x1 = x + (it.width || str.length * size * 0.5);
    cur.size = Math.max(cur.size, size);
    const n = str.replace(/\s/g, '').length;
    cur.chars += n;
    if (bold) cur.boldChars += n;
    if (italic) cur.italicChars += n;
    if (it.hasEOL) cur.eol = true;
  }
  return lines.map((l) => ({
    text: l.text.replace(/\s+/g, ' ').trim(), x: l.x, y: l.y, size: Math.round(l.size * 2) / 2,
    bold: l.chars > 0 && l.boldChars / l.chars > 0.7, italic: l.chars > 0 && l.italicChars / l.chars > 0.7,
  })).filter((l) => l.text);
}

// ---------- the analysis ----------
/**
 * @param pdf      an open pdf.js document (opened with fontExtraProperties: true)
 * @param pdfjs    the pdf.js module (for OPS)
 * @param opts     { title, onProgress(done, total) }
 */
export async function analyseScenario(pdf, pdfjs, { title = 'Scenario', onProgress } = {}) {
  const OPS = pdfjs.OPS;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    let ops = { fnArray: [], argsArray: [] };
    try { ops = await page.getOperatorList(); } catch { /* text only */ }
    const tc = await page.getTextContent();
    const fontOf = (id) => { try { return (id && page.commonObjs.has(id) && page.commonObjs.get(id)?.name) || ''; } catch { return ''; } };
    pages.push({ n, W: vp.width, H: vp.height, lines: pageLines(tc.items, fontOf, vp.height), images: pageImages(ops, OPS, vp.width, vp.height) });
    page.cleanup();
    onProgress?.(n, pdf.numPages);
    await new Promise((r) => setImmediate(r));
  }
  let outline = [];
  try { outline = await flattenOutline(pdf, await pdf.getOutline()); } catch { /* no bookmarks */ }
  return analysePages(pages, { title, outline });
}

async function flattenOutline(pdf, items, level = 1, out = []) {
  for (const o of items || []) {
    if (out.length > 1500) break;
    let page = null;
    try {
      const dest = typeof o.dest === 'string' ? await pdf.getDestination(o.dest) : o.dest;
      if (dest?.[0] != null) page = (typeof dest[0] === 'object' ? await pdf.getPageIndex(dest[0]) : dest[0]) + 1;
    } catch { /* external link or broken bookmark */ }
    if (page && o.title?.trim()) out.push({ title: o.title.replace(/\s+/g, ' ').trim(), level, page });
    if (o.items?.length && level < 4) await flattenOutline(pdf, o.items, level + 1, out);
  }
  return out;
}

/** The layout-independent part, also used by the tests. pages: [{ n, W, H, lines, images }] */
export function analysePages(pages, { title, outline = [] }) {
  const words = (s) => (s.match(/[\p{L}\p{N}']+/gu) || []).length;

  // page furniture: running heads and footers repeated on many pages, and bare page numbers
  const edgeCount = new Map();
  const edgeKey = (l) => fold(l.text).replace(/\d+/g, '#');
  const atEdge = (l, p) => l.y < p.H * 0.08 || l.y > p.H * 0.92;
  for (const p of pages) for (const l of p.lines) if (atEdge(l, p)) edgeCount.set(edgeKey(l), (edgeCount.get(edgeKey(l)) || 0) + 1);
  const repeatAt = Math.max(3, Math.ceil(pages.length * 0.2));
  for (const p of pages) for (const l of p.lines) {
    l.furniture = atEdge(l, p) && (/^[\divxlc\s.\-–|]+$/i.test(l.text) || edgeCount.get(edgeKey(l)) >= repeatAt);
  }

  // the body text size: the size most of the characters are set in
  const bySize = new Map();
  for (const p of pages) for (const l of p.lines) if (!l.furniture && l.text.length >= 20) bySize.set(l.size, (bySize.get(l.size) || 0) + l.text.length);
  const body = [...bySize].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;

  // ---------- section boundaries ----------
  let method = 'headings';
  let marks = []; // { title, level, page, line }
  // where a bookmark's heading sits on its page: prefer heading-looking lines that start with its title
  const findLine = (p, t) => {
    const want = fold(t).slice(0, 40);
    const lines = pages[p - 1]?.lines || [];
    const headingish = (l) => l.bold || l.size >= body * 1.1;
    const tries = [
      (l) => headingish(l) && fold(l.text).startsWith(want),
      (l) => fold(l.text).startsWith(want),
      (l) => headingish(l) && want.length > 6 && fold(l.text).includes(want),
      (l) => headingish(l) && l.text.length > 4 && want.startsWith(fold(l.text)),
    ];
    for (const test of tries) {
      const i = lines.findIndex((l) => !l.furniture && test(l));
      if (i >= 0) return i;
    }
    return 0;
  };
  const usable = outline.filter((o) => o.page >= 1 && o.page <= pages.length);
  if (usable.length >= 3) {
    method = 'bookmarks';
    marks = usable.map((o) => ({ title: o.title, level: o.level, page: o.page, line: findLine(o.page, o.title) }));
  } else {
    // headings: noticeably bigger than body text, or short bold lines on their own
    const cands = [];
    for (const p of pages) {
      for (let i = 0; i < p.lines.length; i++) {
        const l = p.lines[i];
        if (l.furniture || l.text.length < 3 || l.text.length > 110 || words(l.text) > 16 || !/\p{L}{3}/u.test(l.text)) continue;
        if (/^[\p{Lu}]{2,4}\s*[\d(]/u.test(l.text) || /^\d+([.,]\d+)?\s*$/.test(l.text)) continue; // stat lines, numbers
        const big = l.size >= body * 1.18;
        const boldLine = l.bold && l.size >= body * 0.95 && l.text.length <= 70 && !/[,;]$/.test(l.text) && words(l.text) >= 1;
        if (!big && !boldLine) continue;
        cands.push({ p: p.n, i, l, big });
      }
    }
    // join headings that wrap onto two lines
    const joined = [];
    for (const c of cands) {
      const prev = joined.at(-1);
      if (prev && prev.p === c.p && prev.lastI === c.i - 1 && prev.l.size === c.l.size && prev.l.bold === c.l.bold
        && Math.abs(c.l.y - prev.lastY) <= c.l.size * 1.6) {
        prev.title += ` ${c.l.text}`; prev.lastI = c.i; prev.lastY = c.l.y;
      } else joined.push({ ...c, title: c.l.text, lastI: c.i, lastY: c.l.y });
    }
    // levels: each bigger size is a level; bold body-size headings come last
    const sizes = [...new Set(joined.filter((c) => c.big).map((c) => c.l.size))].sort((a, b) => b - a).slice(0, 3);
    marks = joined.map((c) => ({
      title: c.title.slice(0, 120), page: c.p, line: c.i, lastLine: c.lastI,
      level: c.big ? (sizes.includes(c.l.size) ? sizes.indexOf(c.l.size) + 1 : sizes.length) : sizes.length + 1,
    }));
    // a title page heading in huge type is the book's own title, not a section
    if (marks.length > 1 && marks[0].page === 1 && marks.filter((m) => m.level === marks[0].level).length === 1 && marks[0].level === 1) {
      marks[0].isTitle = true;
    }
    // once the book's title is set aside, the biggest remaining headings are level 1
    const top = Math.min(...marks.filter((m) => !m.isTitle).map((m) => m.level));
    if (Number.isFinite(top) && top > 1) for (const m of marks) if (!m.isTitle) m.level -= top - 1;
    if (marks.length > LIMITS.sections) marks = marks.filter((m) => m.level <= 2);
    if (!marks.length) method = 'pages';
  }
  marks.sort((a, b) => a.page - b.page || a.line - b.line);

  // ---------- handouts (needed first, so sections can link to them) ----------
  const HANDOUT = /^(?:player\s+)?(?:handout|player aid)\b\s*#?\s*([\w.-]{1,8})?\s*(?:[:.\-–—]|$)/i;
  const handoutRefs = new Map(); // "handout 1" -> page
  const handouts = [];
  const used = new Set(); // images already claimed (page:index)
  for (const p of pages) {
    for (let i = 0; i < p.lines.length; i++) {
      const l = p.lines[i];
      const m = HANDOUT.exec(l.text);
      if (!m || l.furniture || l.text.length > 100) continue;
      const headingLike = l.bold || l.size >= body * 1.08 || i === 0 || (p.lines[i - 1] && p.lines[i - 1].y < l.y - l.size * 1.8);
      if (!headingLike) continue;
      const key = fold(`handout ${m[1] || l.text}`).replace(/[^a-z0-9 ]/g, '').trim();
      // the picture: the biggest image on the page below the label (or anywhere on it)
      const below = p.images.map((im, k) => ({ im, k })).filter(({ im }) => im.area >= 0.03 && im.y + im.h > l.y / p.H - 0.02);
      const pick = (below.length ? below : p.images.map((im, k) => ({ im, k })).filter(({ im }) => im.area >= 0.03)).sort((a, b) => b.im.area - a.im.area)[0];
      const existing = handouts.find((h) => h.key === key);
      const entry = { id: `h${handouts.length + 1}`, key, label: l.text.replace(/\s*[:.\-–—]\s*$/, '').slice(0, 90), page: p.n,
        rect: pick ? pad(pick.im) : null, kind: 'labelled' };
      if (existing) {
        // prefer the one that actually has a picture, or appears later (handout appendices)
        if (!existing.rect && entry.rect) Object.assign(existing, { ...entry, id: existing.id });
        continue;
      }
      if (pick) used.add(`${p.n}:${pick.k}`);
      handouts.push(entry);
      if (handouts.length >= LIMITS.handouts) break;
    }
  }
  for (const h of handouts) if (m2(h.key)) handoutRefs.set(m2(h.key), h.page);
  function m2(key) { const m = /^handout ([\w.-]+)/.exec(key); return m ? m[1] : null; }

  // ---------- maps ----------
  const maps = [];
  const outlineTitle = (n) => marks.filter((m) => m.page === n).map((m) => m.title).join(' ');
  for (const p of pages) {
    const text = p.lines.filter((l) => !l.furniture).map((l) => l.text).join(' ');
    const mapWords = /\b(map|maps|plan|floor ?plan|layout|ground floor|first floor|cellar|level \d)\b/i;
    p.images.forEach((im, k) => {
      if (used.has(`${p.n}:${k}`) || im.area < 0.22 || maps.length >= LIMITS.maps) return;
      const caption = p.lines.find((l) => !l.furniture && /\b(map|plan)\b/i.test(l.text) && l.text.length < 90);
      const likely = caption || mapWords.test(outlineTitle(p.n)) || (mapWords.test(text) && im.area >= 0.35);
      const picture = !likely && im.area >= 0.5 && words(text) < 80;
      if (!likely && !picture) return;
      used.add(`${p.n}:${k}`);
      maps.push({ id: `m${maps.length + 1}`, page: p.n, rect: pad(im), confidence: likely ? 'high' : 'low',
        label: (caption?.text || (mapWords.test(outlineTitle(p.n)) ? outlineTitle(p.n) : '') || (likely ? `Map, p. ${p.n}` : `Picture, p. ${p.n}`)).slice(0, 80) });
    });
  }
  // unlabelled pictures on pages headed "Papers & Clues" / "Handouts" count as handouts too
  for (const p of pages) {
    const head = p.lines.slice(0, 4).map((l) => l.text).join(' ');
    if (!/papers\s*(&|and)\s*clues|handouts|player aids/i.test(head + ' ' + outlineTitle(p.n))) continue;
    p.images.forEach((im, k) => {
      if (used.has(`${p.n}:${k}`) || im.area < 0.04 || handouts.length >= LIMITS.handouts) return;
      used.add(`${p.n}:${k}`);
      handouts.push({ id: `h${handouts.length + 1}`, key: `picture ${p.n}:${k}`, label: `Picture, p. ${p.n}`, page: p.n, rect: pad(im), kind: 'picture' });
    });
  }

  // ---------- sections, paragraphs and read-aloud text ----------
  const readAloud = [];
  const linkHandouts = (s) => s.replace(/\b((?:Player\s+)?Handout\s*#?\s*([\w.-]{1,8}?))\b(?=[\s:.,;)'"’”]|$)/g, (all, label, n) => {
    const page = handoutRefs.get(n.toLowerCase());
    return page ? `[[pdf:${title}#${page}|${label}]]` : `**${label}**`;
  });
  const safeStart = (s) => (/^(#|>|-|\||\d+\.\s|\*\s|---)/.test(s) ? `​${s}` : s);

  function sectionBody(from, to) {
    // lines from position `from` up to (not including) `to`; positions are [page, lineIndex]
    const paras = [];
    let cur = null, prev = null;
    const flush = () => { if (cur?.text.trim()) paras.push(cur); cur = null; };
    for (let pn = from[0]; pn <= Math.min(to[0], pages.length); pn++) {
      const p = pages[pn - 1];
      const start = pn === from[0] ? from[1] : 0;
      const end = pn === to[0] ? to[1] : p.lines.length;
      for (let i = start; i < end; i++) {
        const l = p.lines[i];
        if (l.furniture) continue;
        const subhead = l.bold && !l.italic && l.text.length <= 70 && words(l.text) <= 10 && !/[.,;]$/.test(l.text) && l.size >= body * 0.95;
        const gap = prev && prev.page === pn ? l.y - prev.y : 0;
        const ended = !prev || /[.!?:"”’)]$/.test(prev.text);
        const newPara = !cur || subhead || cur.subhead || l.italic !== cur.italic
          || gap > l.size * 1.75 || (prev && prev.page === pn && gap < -l.size * 2 && ended)
          || (prev && prev.page !== pn && ended && /^[\p{Lu}"“]/u.test(l.text));
        if (newPara) { flush(); cur = { text: '', italic: l.italic, subhead, page: pn }; }
        if (cur.text.endsWith('-') && /^\p{Ll}/u.test(l.text)) cur.text = cur.text.slice(0, -1) + l.text;
        else cur.text += (cur.text ? ' ' : '') + l.text;
        prev = { ...l, page: pn };
      }
    }
    flush();
    const out = [];
    let lastPage = null;
    for (const para of paras) {
      const t = para.text.replace(/\s+/g, ' ').trim();
      const read = (para.italic && words(t) >= 14) || /^(read aloud|read or paraphrase|to the players|box text)\b/i.test(t);
      if (para.page !== lastPage && lastPage !== null) out.push(`*[[pdf:${title}#${para.page}|p. ${para.page}]]*`);
      lastPage = para.page;
      if (para.subhead) { out.push(`### ${t.replace(/^#+\s*/, '')}`); continue; }
      if (read) {
        const clean = t.replace(/^(read aloud|read or paraphrase|to the players|box text)\s*[:.\-–—]?\s*/i, '');
        if (readAloud.length < LIMITS.readAloud) readAloud.push({ id: `r${readAloud.length + 1}`, page: para.page, text: clean.slice(0, 2000) });
        out.push(`> ${linkHandouts(clean)}`);
        continue;
      }
      out.push(safeStart(linkHandouts(t)));
    }
    return out.join('\n\n');
  }

  const sections = [];
  const bounds = marks.filter((m) => !m.isTitle);
  // anything before the first heading
  const first = bounds[0] ? [bounds[0].page, bounds[0].line] : [pages.length + 1, 0];
  const intro = sectionBody([1, 0], first);
  if (words(intro) > 60) sections.push({ title: method === 'pages' ? title : 'Introduction', level: 1, page: 1, text: intro });
  bounds.forEach((m, i) => {
    const next = bounds[i + 1];
    const startLine = (m.lastLine ?? m.line) + 1;
    const text = sectionBody([m.page, startLine], next ? [next.page, next.line] : [pages.length + 1, 0]);
    sections.push({ title: m.title, level: m.level, page: m.page, text });
  });
  sections.forEach((s, i) => {
    s.id = `s${i + 1}`;
    s.endPage = sections[i + 1] ? Math.max(s.page, sections[i + 1].page) : pages.length;
    s.words = words(s.text.replace(/\[\[[^\]]*\]\]/g, ''));
    if (s.text.length > 150_000) s.text = `${s.text.slice(0, 150_000)}\n\n*(Cut short here — see the PDF for the rest.)*`;
  });

  return {
    version: SCENARIO_VERSION, title, pages: pages.length, method, bodySize: body,
    sections: sections.slice(0, LIMITS.sections),
    readAloud,
    handouts: handouts.map(({ key, ...h }) => h),
    maps,
  };
}

function pad(r, by = 0.008) {
  const x = Math.max(0, r.x - by), y = Math.max(0, r.y - by);
  return { x, y, w: Math.min(1 - x, r.w + by * 2), h: Math.min(1 - y, r.h + by * 2) };
}
