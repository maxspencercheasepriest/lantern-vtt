// A small, safe Markdown subset for notes and rules text.
//   # / ## / ###      headings            **bold**  *italic*  `code`
//   - item / 1. item  lists               > text    read-aloud / boxed text
//   | a | b |         tables              ---       rule
//   [text](https://…) external link
//   [[Note title]]                        link to a note
//   [[pdf:Book title#12]]                 link to page 12 of a library PDF
//   [[spell:Fireball]] [[monster:Goblin]] [[condition:Prone]] [[item:…]] [[equipment:…]] [[rule:…]]
// Everything is HTML-escaped first; only the tags generated here are produced.
import { esc } from './esc.js';

const XREF_CATS = { monster: 'monsters', spell: 'spells', condition: 'conditions', item: 'magic-items', equipment: 'equipment', rule: 'rules', ref: 'reference' };

function inline(text) {
  let s = esc(text);
  // [[links]] first, so their contents aren't formatted
  s = s.replace(/\[\[([^\]]{1,160})\]\]/g, (m, inner) => {
    const raw = inner.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    let mm;
    if ((mm = /^pdf:(.+?)(?:#(\d+))?$/i.exec(raw))) {
      const label = `${mm[1]}${mm[2] ? ` p. ${mm[2]}` : ''}`;
      return `<a class="xref" data-xref="pdf" data-title="${esc(mm[1].trim())}" data-page="${mm[2] || 1}">${esc(label)}</a>`;
    }
    if ((mm = /^(monster|spell|condition|item|equipment|rule|ref):(.+)$/i.exec(raw))) {
      return `<a class="xref" data-xref="rules" data-cat="${XREF_CATS[mm[1].toLowerCase()]}" data-name="${esc(mm[2].trim())}">${esc(mm[2].trim())}</a>`;
    }
    const [target, label] = raw.split('|');
    return `<a class="xref" data-xref="note" data-title="${esc(target.trim())}">${esc((label || target).trim())}</a>`;
  });
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<i>$2</i>');
  return s;
}

export function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    let m;
    if (!t) { flush(); i++; continue; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(t))) { flush(); const lv = Math.min(4, m[1].length + 1); out.push(`<h${lv}>${inline(m[2])}</h${lv}>`); i++; continue; }
    if (/^(-{3,}|\*{3,})$/.test(t)) { flush(); out.push('<hr>'); i++; continue; }
    if (t.startsWith('>')) {
      flush();
      const box = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) { box.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${box.map((b) => (b ? inline(b) : '<br>')).join('<br>')}</blockquote>`);
      continue;
    }
    if (t.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) {
      flush();
      const row = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(t);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { body.push(row(lines[i])); i++; }
      out.push(`<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if ((m = /^([-*•]|\d+\.)\s+/.exec(t))) {
      flush();
      const ordered = /\d/.test(m[1]);
      const items = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        const mm = /^([-*•]|\d+\.)\s+(.*)$/.exec(l);
        if (mm && /\d/.test(mm[1]) === ordered) { items.push(mm[2]); i++; }
        else if (l && !/^([-*•]|\d+\.)\s/.test(l) && items.length && /^\s{2,}/.test(lines[i])) { items[items.length - 1] += ` ${l}`; i++; }
        else break;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    para.push(t);
    i++;
  }
  flush();
  return out.join('\n');
}

/** Plain text for search snippets. */
export const plainText = (src) => String(src || '').replace(/\[\[(?:[a-z]+:)?([^\]|#]+)(?:#\d+)?(?:\|([^\]]+))?\]\]/gi, (m, a, b) => b || a)
  .replace(/[#>*_`|]/g, ' ').replace(/-{3,}/g, ' ').replace(/\s+/g, ' ').trim();
