// Runs inside the Roll20 page itself (the "main world"), where window.Campaign
// lives. It reads the campaign out of Roll20's own objects and hands it to
// panel.js, which saves the file. Nothing is sent anywhere.
//
// Roll20 has no export of its own and no documented API for this, so every read
// is defensive: if a field has moved, that field is recorded in `diagnostics`
// and everything else still comes across.
(() => {
  const TAG = 'lantern-roll20';

  const say = (type, data) => window.postMessage({ source: TAG, type, ...data }, '*');
  const diag = [];
  const note = (what) => { if (!diag.includes(what)) diag.push(what); };

  const attrs = (model) => (model && model.attributes) || {};
  const get = (model, key, fallback = null) => {
    try {
      const v = model && typeof model.get === 'function' ? model.get(key) : attrs(model)[key];
      return v === undefined ? fallback : v;
    } catch { return fallback; }
  };
  const models = (collection) => {
    if (!collection) return [];
    if (Array.isArray(collection.models)) return collection.models;
    if (Array.isArray(collection)) return collection;
    return [];
  };

  // bio, notes and gmnotes are stored away from the model and arrive late.
  // Try the quick ways first, then Roll20's own callback, then give up politely.
  function blob(model, field) {
    return new Promise((resolve) => {
      const direct = get(model, field, null);
      if (typeof direct === 'string' && direct !== 'undefined') return resolve(direct);

      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(typeof v === 'string' ? v : ''); } };
      setTimeout(() => { if (!settled) { note(`${field} took too long to load for at least one entry`); done(''); } }, 4000);

      try {
        if (typeof model._getLatestBlob === 'function') return model._getLatestBlob(field, done);
        if (typeof model.getBlob === 'function') return model.getBlob(field, done);
        if (model.blobcache && typeof model.blobcache[field] === 'string') return done(model.blobcache[field]);
      } catch { /* fall through */ }
      note(`${field} could not be read (Roll20 has changed how it stores these)`);
      done('');
    });
  }

  // Roll20 paths are a JSON string of SVG-ish moves, relative to the path's own box.
  function points(path) {
    const raw = get(path, 'path', '');
    let steps;
    try { steps = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return []; }
    if (!Array.isArray(steps)) return [];
    const left = Number(get(path, 'left', 0)) || 0;
    const top = Number(get(path, 'top', 0)) || 0;
    const w = Number(get(path, 'width', 0)) || 0;
    const h = Number(get(path, 'height', 0)) || 0;
    const sx = Number(get(path, 'scaleX', 1)) || 1;
    const sy = Number(get(path, 'scaleY', 1)) || 1;
    // the stored points are measured from the path's top-left, before scaling
    const x0 = left - (w * sx) / 2;
    const y0 = top - (h * sy) / 2;
    const out = [];
    for (const step of steps) {
      if (!Array.isArray(step) || step.length < 3) continue;
      out.push([x0 + Number(step[1]) * sx, y0 + Number(step[2]) * sy]);
    }
    return out;
  }

  const graphic = (g) => ({
    id: get(g, 'id', ''),
    name: get(g, 'name', ''),
    imgsrc: get(g, 'imgsrc', ''),
    left: Number(get(g, 'left', 0)) || 0,
    top: Number(get(g, 'top', 0)) || 0,
    width: Number(get(g, 'width', 0)) || 0,
    height: Number(get(g, 'height', 0)) || 0,
    rotation: Number(get(g, 'rotation', 0)) || 0,
    layer: get(g, 'layer', 'objects'),
    represents: get(g, 'represents', ''),
    isdrawing: !!get(g, 'isdrawing', false),
    flipv: !!get(g, 'flipv', false),
    fliph: !!get(g, 'fliph', false),
    tint: get(g, 'tint_color', '') || '',
    controlledby: get(g, 'controlledby', '') || '',
    statusmarkers: get(g, 'statusmarkers', '') || '',
    bars: [1, 2, 3].map((n) => ({
      value: get(g, `bar${n}_value`, ''),
      max: get(g, `bar${n}_max`, ''),
    })),
  });

  const pathOf = (p) => ({
    id: get(p, 'id', ''),
    layer: get(p, 'layer', 'objects'),
    stroke: get(p, 'stroke', '') || '',
    strokeWidth: Number(get(p, 'stroke_width', 0)) || 0,
    fill: get(p, 'fill', 'transparent') || 'transparent',
    barrierType: get(p, 'barrierType', '') || '',
    oneWayReversed: !!get(p, 'oneWayReversed', false),
    points: points(p),
  });

  const doorOf = (d) => ({
    id: get(d, 'id', ''),
    kind: get(d, 'isOpen', null) === null ? 'window' : 'door',
    isOpen: !!get(d, 'isOpen', false),
    isLocked: !!get(d, 'isLocked', false),
    isSecret: !!get(d, 'isSecret', false),
    x: Number(get(d, 'x', 0)) || 0,
    y: Number(get(d, 'y', 0)) || 0,
    path: get(d, 'path', null),
  });

  async function scrape() {
    const C = window.Campaign;
    if (!C) throw new Error('No campaign found on this page. Open a game (the tabletop), then try again.');

    const pageModels = models(C.pages).filter((p) => !get(p, 'archived', false));
    const charModels = models(C.characters);
    const handoutModels = models(C.handouts);
    const total = pageModels.length + charModels.length + handoutModels.length || 1;
    let done = 0;
    const tick = (label) => say('progress', { done: ++done, total, label });

    const pages = pageModels.map((p) => {
      const a = attrs(p);
      const graphics = models(p.thegraphics).map(graphic);
      const paths = models(p.thepaths).map(pathOf);
      const doors = models(p.thedoors || p.thewindows).map(doorOf);
      if (!p.thegraphics) note('one or more pages had no readable tokens');
      tick(a.name || 'page');
      return {
        id: get(p, 'id', ''),
        name: a.name || 'Map',
        width: Number(a.width) || 25,           // in squares
        height: Number(a.height) || 25,
        snapping_increment: Number(a.snapping_increment) || 1,
        scale_number: Number(a.scale_number) || 5,
        scale_units: a.scale_units || 'ft',
        background_color: a.background_color || '',
        showgrid: a.showgrid !== false,
        gridcolor: a.gridcolor || '',
        grid_opacity: a.grid_opacity == null ? 0.5 : Number(a.grid_opacity),
        diagonaltype: a.diagonaltype || 'foure',
        dynamicLighting: !!(a.dynamic_lighting_enabled || a.daylight_mode_enabled || a.fog_opacity),
        thumbnail: a.thumbnail || '',
        graphics,
        paths,
        doors,
      };
    });

    const characters = [];
    for (const c of charModels) {
      const a = attrs(c);
      let attribs = [];
      try {
        attribs = models(c.attribs).map((x) => ({
          name: get(x, 'name', ''),
          current: get(x, 'current', ''),
          max: get(x, 'max', ''),
        })).filter((x) => x.name);
      } catch { note('some character attributes could not be read'); }
      if (!attribs.length && models(c.attribs).length === 0) note('a character had no attributes loaded — open its sheet once and export again');
      characters.push({
        id: get(c, 'id', ''),
        name: a.name || 'Unnamed',
        avatar: a.avatar || '',
        defaulttoken: a.defaulttoken ? true : false,
        tags: a.tags || '',
        controlledby: a.controlledby || '',
        inplayerjournals: a.inplayerjournals || '',
        archived: !!a.archived,
        bio: await blob(c, 'bio'),
        gmnotes: await blob(c, 'gmnotes'),
        attribs,
      });
      tick(a.name || 'character');
    }

    const handouts = [];
    for (const h of handoutModels) {
      const a = attrs(h);
      handouts.push({
        id: get(h, 'id', ''),
        name: a.name || 'Handout',
        avatar: a.avatar || '',
        inplayerjournals: a.inplayerjournals || '',
        archived: !!a.archived,
        notes: await blob(h, 'notes'),
        gmnotes: await blob(h, 'gmnotes'),
      });
      tick(a.name || 'handout');
    }

    return {
      format: 'lantern-roll20',
      version: 1,
      exported: new Date().toISOString(),
      campaign: {
        id: String(get(C, 'id', '') || ''),
        name: get(C, 'name', '') || document.title.replace(/\s*\|\s*Roll20.*$/i, '').trim() || 'Roll20 campaign',
      },
      pages,
      characters,
      handouts,
      diagnostics: diag,
    };
  }

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.source !== `${TAG}-panel` || e.data.type !== 'export') return;
    try {
      say('started', {});
      const data = await scrape();
      say('done', { data });
    } catch (err) {
      say('failed', { message: String(err && err.message ? err.message : err) });
    }
  });

  say('ready', {});
})();
