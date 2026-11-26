// The .lantern module file: a prepared campaign or scenario with its pictures, music and PDFs, in one file.
// Lantern Server (Lantern Plus) exports them from its marketplace; any Lantern, the desktop app included, can open
// one into a game (server.js importModule). Older .lantern files were zips, and a Mac may have unpacked one and
// zipped the folder again: unpackModule reads all of those.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ---------- the .lantern file format ----------
// A file type of its own (not a zip, so browsers and Finder leave it alone):
//   "LANTERN1"                                   8 bytes: the signature
//   then records, one after another:
//     kind     1 byte   'H' the module (JSON: { format, meta, snapshot, docs }), 'F' a file, 'E' the end
//     nameLen  2 bytes  big-endian, then the name in UTF-8 (a file's path: uploads/<file> or pdfs/<id>.pdf)
//     size     8 bytes  big-endian, then that many bytes
// Pictures, music and PDFs are already compressed, so they're stored as they are; the JSON is gzipped ('H' is
// gzip of the JSON). Older .lantern files were zips: importFrom still reads those.
export const LANTERN_MAGIC = Buffer.from('LANTERN1');
export const LANTERN_MIME = 'application/x-lantern-module';
const recordHead = (kind, name, size) => {
  const n = Buffer.from(name, 'utf8');
  const b = Buffer.alloc(1 + 2 + n.length + 8);
  b.write(kind, 0, 'latin1');
  b.writeUInt16BE(n.length, 1);
  n.copy(b, 3);
  b.writeBigUInt64BE(BigInt(size), 3 + n.length);
  return b;
};

/** Write a .lantern file: head (an object) and files [{ name, file }]. */
export async function writeLantern(outPath, head, files) {
  const fh = await fs.promises.open(outPath, 'w');
  try {
    await fh.write(LANTERN_MAGIC);
    const json = zlib.gzipSync(Buffer.from(JSON.stringify(head)));
    await fh.write(recordHead('H', 'lantern-module.json', json.length));
    await fh.write(json);
    const buf = Buffer.alloc(1 << 20);
    for (const f of files) {
      const src = await fs.promises.open(f.file, 'r');
      try {
        const { size } = await src.stat();
        await fh.write(recordHead('F', f.name, size));
        let left = size;
        while (left > 0) {
          const { bytesRead } = await src.read(buf, 0, Math.min(buf.length, left), null);
          if (!bytesRead) throw new Error(`${f.name} got shorter while it was being exported`);
          await fh.write(buf.subarray(0, bytesRead));
          left -= bytesRead;
        }
      } finally { await src.close(); }
    }
    await fh.write(recordHead('E', '', 0));
  } finally { await fh.close(); }
}

// ---------- reading zips (older .lantern files) from their table of contents ----------
/** The entries of a zip file: [{ name, dir, method, size, csize, offset }]. Handles zip64. */
export async function zipEntries(file) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size: fileSize } = await fh.stat();
    const tail = Math.min(fileSize, 65557 + 20);
    const end = Buffer.alloc(tail);
    await fh.read(end, 0, tail, fileSize - tail);
    let at = -1;
    for (let i = tail - 22; i >= 0; i--) if (end.readUInt32LE(i) === 0x06054b50) { at = i; break; }
    if (at < 0) throw new Error("it isn't a zip");
    let count = end.readUInt16LE(at + 10), cdSize = end.readUInt32LE(at + 12), cdOff = end.readUInt32LE(at + 16);
    if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) {
      // zip64: the locator sits just before the end record
      if (at < 20 || end.readUInt32LE(at - 20) !== 0x07064b50) throw new Error('the zip is damaged');
      const z64 = Number(end.readBigUInt64LE(at - 12));
      const r = Buffer.alloc(56);
      await fh.read(r, 0, 56, z64);
      if (r.readUInt32LE(0) !== 0x06064b50) throw new Error('the zip is damaged');
      count = Number(r.readBigUInt64LE(32)); cdSize = Number(r.readBigUInt64LE(40)); cdOff = Number(r.readBigUInt64LE(48));
    }
    if (cdSize > 256 * 1024 * 1024) throw new Error('the zip lists too many files');
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOff);
    const out = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('the zip is damaged');
      const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10);
      let csize = cd.readUInt32LE(p + 20), size = cd.readUInt32LE(p + 24);
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const raw = cd.subarray(p + 46, p + 46 + nl);
      const name = (flags & 0x800 ? raw.toString('utf8') : raw.toString('latin1')).replace(/\\/g, '/');
      // zip64 sizes and offset live in an extra field
      let x = p + 46 + nl;
      const xe = x + xl;
      while (x + 4 <= xe) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (size === 0xffffffff) { size = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (offset === 0xffffffff) { offset = Number(cd.readBigUInt64LE(q)); }
        }
        x += 4 + len;
      }
      out.push({ name, dir: name.endsWith('/'), method, size, csize, offset, encrypted: !!(flags & 1) });
      p = xe + cl;
    }
    return out;
  } finally { await fh.close(); }
}

/** One entry's contents: written to `to` if given, otherwise returned as a Buffer. */
export async function zipRead(file, e, to = null) {
  if (e.encrypted) throw new Error('it has a password');
  if (e.method !== 0 && e.method !== 8) throw new Error('it uses a kind of compression Lantern can\'t read');
  const fh = await fs.promises.open(file, 'r');
  let start;
  try {
    const h = Buffer.alloc(30);
    await fh.read(h, 0, 30, e.offset);
    if (h.readUInt32LE(0) !== 0x04034b50) throw new Error('the zip is damaged');
    start = e.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
  } finally { await fh.close(); }
  const { pipeline } = await import('node:stream/promises');
  const src = e.csize ? fs.createReadStream(file, { start, end: start + e.csize - 1 }) : (await import('node:stream')).Readable.from([]);
  const steps = [src];
  if (e.method === 8) steps.push(zlib.createInflateRaw());
  if (to) { await pipeline(...steps, fs.createWriteStream(to)); return null; }
  const parts = [];
  await pipeline(...steps, async function* (s) { for await (const c of s) parts.push(c); });
  return Buffer.concat(parts);
}

/** Is this file in the new format (rather than an older zip)? */
export function isLanternFile(file) {
  const b = Buffer.alloc(8);
  const fd = fs.openSync(file, 'r');
  try { return fs.readSync(fd, b, 0, 8, 0) === 8 && b.equals(LANTERN_MAGIC); } finally { fs.closeSync(fd); }
}

/**
 * Read a .lantern file: the module comes back as { head }, and each file is handed to where(name), which
 * returns a path to write it to (or null to skip it).
 */
export async function readLantern(file, where) {
  const fh = await fs.promises.open(file, 'r');
  let pos = 8, head = null;
  const read = async (n) => {
    const b = Buffer.alloc(n);
    const { bytesRead } = await fh.read(b, 0, n, pos);
    if (bytesRead !== n) throw new Error('the file stops part-way through');
    pos += n;
    return b;
  };
  try {
    const magic = Buffer.alloc(8);
    await fh.read(magic, 0, 8, 0);
    if (!magic.equals(LANTERN_MAGIC)) throw new Error("it isn't a Lantern module");
    const buf = Buffer.alloc(1 << 20);
    for (;;) {
      const kind = (await read(1)).toString('latin1');
      const nameLen = (await read(2)).readUInt16BE(0);
      const name = (await read(nameLen)).toString('utf8');
      const size = Number((await read(8)).readBigUInt64BE(0));
      if (kind === 'E') break;
      if (kind === 'H') {
        if (size > 200 * 1024 * 1024) throw new Error('the module part is too big');
        head = JSON.parse(zlib.gunzipSync(await read(size)).toString('utf8'));
        continue;
      }
      if (kind !== 'F') throw new Error('the file is damaged');
      const dest = where(name);
      if (!dest) { pos += size; continue; }
      const out = await fs.promises.open(`${dest}.part`, 'w');
      try {
        let left = size;
        while (left > 0) {
          const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, left), pos);
          if (!bytesRead) throw new Error('the file stops part-way through');
          await out.write(buf.subarray(0, bytesRead));
          pos += bytesRead; left -= bytesRead;
        }
      } finally { await out.close(); }
      await fs.promises.rename(`${dest}.part`, dest);
    }
  } finally { await fh.close(); }
  return { head };
}

const UPLOAD_NAME = /^uploads\/([\w-]{8,64}\.[a-z0-9]{2,5})$/i;
const PDF_NAME = /^pdfs\/([a-f0-9]{8,32})\.pdf$/;
const okHead = (head) => head && head.format === 1 && head.meta && typeof head.meta === 'object' && head.snapshot && typeof head.snapshot === 'object';

/**
 * Unpack a .lantern file (either format). Pictures and music go straight into uploadsDir (ones already there are
 * kept); PDFs go into pdfDir as <id>.pdf, for the caller to add to its library. Returns
 * { head: { format, meta, snapshot, docs }, uploads: <count added>, pdfs: [ids] }. Errors are plain words.
 */
export async function unpackModule(file, { uploadsDir, pdfDir = null }) {
  const pdfs = [];
  let uploads = 0;
  const where = (name) => {
    let m = UPLOAD_NAME.exec(name);
    if (m) {
      const dest = path.join(uploadsDir, m[1]);
      if (fs.existsSync(dest)) return null;
      uploads++;
      return dest;
    }
    if ((m = PDF_NAME.exec(name)) && pdfDir) { pdfs.push(m[1]); return path.join(pdfDir, `${m[1]}.pdf`); }
    return null;
  };
  fs.mkdirSync(uploadsDir, { recursive: true });
  if (pdfDir) fs.mkdirSync(pdfDir, { recursive: true });
  let head;
  if (isLanternFile(file)) {
    ({ head } = await readLantern(file, where).catch((e) => { throw new Error(`That file couldn't be read (${e.message}). Export it again and retry`); }));
  } else {
    let entries;
    try { entries = await zipEntries(file); } catch (e) { throw new Error(e.message === "it isn't a zip" ? "That isn't a Lantern module (.lantern) file" : `That file couldn't be unpacked (${e.message}). Export it again and retry`); }
    entries = entries.filter((e) => !e.dir && !/(^|\/)(__MACOSX|\.)/.test(e.name));
    // where the module sits: the folder holding lantern-module.json, however deep
    const json = entries.filter((e) => /(^|\/)lantern-module\.json$/.test(e.name)).sort((a, b) => a.name.length - b.name.length)[0];
    if (!json) throw new Error("That isn't a Lantern module (.lantern) file");
    const top = json.name.slice(0, -'lantern-module.json'.length);
    try {
      if (json.size > 200 * 1024 * 1024) throw new Error('the module part is too big');
      head = JSON.parse((await zipRead(file, json)).toString('utf8'));
      if (okHead(head)) {
        for (const e of entries) {
          if (!e.name.startsWith(top)) continue;
          const dest = where(e.name.slice(top.length));
          if (!dest) continue;
          await zipRead(file, e, `${dest}.part`);
          fs.renameSync(`${dest}.part`, dest);
        }
      }
    } catch (e) { throw new Error(`That file couldn't be unpacked (${e.message}). Export it again and retry`); }
  }
  if (!okHead(head)) throw new Error("That isn't a Lantern module (.lantern) file");
  return { head, uploads, pdfs };
}

/** Just the module's description ({ title, ruleset, … } from its meta), without unpacking anything. */
export async function readModuleHead(file) {
  if (isLanternFile(file)) {
    const fh = await fs.promises.open(file, 'r');
    try {
      const b = Buffer.alloc(11);
      await fh.read(b, 0, 11, 8);
      if (b.toString('latin1', 0, 1) !== 'H') throw new Error('the file is damaged');
      const nameLen = b.readUInt16BE(1);
      const sz = Buffer.alloc(8);
      await fh.read(sz, 0, 8, 8 + 3 + nameLen);
      const size = Number(sz.readBigUInt64BE(0));
      if (size > 200 * 1024 * 1024) throw new Error('the module part is too big');
      const json = Buffer.alloc(size);
      await fh.read(json, 0, size, 8 + 3 + nameLen + 8);
      const head = JSON.parse(zlib.gunzipSync(json).toString('utf8'));
      if (!okHead(head)) throw new Error("it isn't a Lantern module");
      return head.meta;
    } catch (e) { throw new Error(`That file couldn't be read (${e.message})`); } finally { await fh.close(); }
  }
  let entries;
  try { entries = await zipEntries(file); } catch { throw new Error("That isn't a Lantern module (.lantern) file"); }
  const json = entries.filter((e) => !/(^|\/)(__MACOSX|\.)/.test(e.name) && /(^|\/)lantern-module\.json$/.test(e.name)).sort((a, b) => a.name.length - b.name.length)[0];
  if (!json) throw new Error("That isn't a Lantern module (.lantern) file");
  const head = JSON.parse((await zipRead(file, json)).toString('utf8'));
  if (!okHead(head)) throw new Error("That isn't a Lantern module (.lantern) file");
  return head.meta;
}
