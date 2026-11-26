// Tidy the names of a batch of pictures (from a zip of handouts or maps) into something readable.
//   "Call of Cthulhu - The Masks of Nyarlathotep Companion - Bloody Botany (Shanghai) - Handout #2.jpg"
//     → { name: 'Bloody Botany - Handout #2', group: 'Shanghai' }
//   "masks maps/Appartments-02-1st-Floor.jpg" → { name: 'Appartments 02 1st Floor', group: '' }
// The words every file starts with (the product name) are dropped; a place in brackets, or the folder the
// file was in (below the zip's own top folder), becomes its group.

const stem = (p) => String(p).split('/').pop().replace(/\.[a-z0-9]{2,5}$/i, '');

export function tidyNames(paths) {
  const stems = paths.map(stem);
  // the prefix most of the names share (a product name), cut at a " - "; the odd file without it keeps its name
  let common = '';
  const counts = new Map();
  for (const st of stems) {
    const parts = st.split(' - ');
    for (let j = 1; j < parts.length; j++) { const c = parts.slice(0, j).join(' - '); counts.set(c, (counts.get(c) || 0) + 1); }
  }
  const need = Math.max(2, Math.ceil(stems.length * 0.5));
  for (const [c, n] of counts) if (n >= need && c.length > common.length) common = c;
  // folders inside the zip (ignoring a single top folder that everything is in)
  const dirs = paths.map((p) => String(p).split('/').slice(0, -1));
  const top = dirs.every((d) => d.length && d[0] === dirs[0][0]) ? 1 : 0;
  return paths.map((p, i) => {
    let s = stems[i];
    if (common && s.startsWith(common + ' - ')) s = s.slice(common.length + 3);
    s = s.replace(/_s\b/g, '’s').replace(/(?<=\w)_(?=\w)/g, ' ');
    if (!/\s/.test(s)) s = s.replace(/[-_]+/g, ' ');
    let group = '';
    const bracket = /\s*\(([^()]{2,40})\)\s*/.exec(s);
    if (bracket) { group = bracket[1].trim(); s = (s.slice(0, bracket.index) + ' ' + s.slice(bracket.index + bracket[0].length)).trim(); }
    if (!group) group = dirs[i].slice(top).join(' / ');
    s = s.replace(/\s+-\s+-\s+/g, ' - ').replace(/^\s*-\s*|\s*-\s*$/g, '').replace(/\s+/g, ' ').trim();
    return { name: (s || stems[i]).slice(0, 80), group: group.slice(0, 40) };
  });
}

/** What kind of picture these bytes are, from their first few bytes (not the file name). */
export function imageKind(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  return null;
}
