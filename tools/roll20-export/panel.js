// The little panel in the corner of Roll20, and the bit that saves the file.
// It can't see window.Campaign (different world), so page.js does the reading
// and posts the result over.
(() => {
  const TAG = 'lantern-roll20';

  const box = document.createElement('div');
  box.className = 'lantern-export';
  box.innerHTML = `
    <div class="le-head"><span class="le-dot"></span>Lantern export</div>
    <button class="le-go" type="button">Save campaign for Lantern</button>
    <div class="le-status">Reading the campaign happens here in your browser. Nothing is uploaded.</div>`;
  const btn = box.querySelector('.le-go');
  const status = box.querySelector('.le-status');
  const show = (text) => { status.textContent = text; };

  const place = () => { if (!document.body.contains(box)) document.body.append(box); };
  place();
  new MutationObserver(place).observe(document.documentElement, { childList: true, subtree: false });

  // dragging, because Roll20 puts things everywhere
  let drag = null;
  box.querySelector('.le-head').addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, top: box.offsetTop, left: box.offsetLeft };
    box.setPointerCapture?.(e.pointerId);
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    box.style.top = `${drag.top + e.clientY - drag.y}px`;
    box.style.left = `${drag.left + e.clientX - drag.x}px`;
    box.style.right = 'auto';
  });
  window.addEventListener('pointerup', () => { drag = null; });

  btn.addEventListener('click', () => {
    btn.disabled = true;
    show('Starting…');
    window.postMessage({ source: `${TAG}-panel`, type: 'export' }, '*');
  });

  function save(data) {
    const name = String(data.campaign?.name || 'roll20')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'roll20';
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.lantern.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== TAG) return;
    const d = e.data;
    if (d.type === 'ready') show('Ready. Open the game you want to export.');
    if (d.type === 'started') show('Reading pages, characters and handouts…');
    if (d.type === 'progress') show(`${d.done} of ${d.total} — ${d.label}`);
    if (d.type === 'failed') { btn.disabled = false; show(`Couldn't export: ${d.message}`); }
    if (d.type === 'done') {
      btn.disabled = false;
      const n = d.data;
      save(n);
      const counts = `${n.pages.length} maps, ${n.characters.length} characters, ${n.handouts.length} handouts`;
      show(`Saved. ${counts}. Import it in Lantern under Library → Import.${n.diagnostics.length ? ` Note: ${n.diagnostics.join('; ')}.` : ''}`);
    }
  });
})();
