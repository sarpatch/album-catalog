// Kansikuvan rajaus: vedä siirtääksesi, nipistä / rullaa / liukusäädin zoomataksesi,
// kierrä 90°. Tulos on neliön muotoinen JPEG.

import { h, icon, openDialog } from './ui.js';
import { loadBitmap, renderSquare, FULL_SIZE } from './image.js';

function rotated(src, quarterTurns) {
  const w = src.width; const hgt = src.height;
  const c = document.createElement('canvas');
  const odd = quarterTurns % 2 === 1;
  c.width = odd ? hgt : w; c.height = odd ? w : hgt;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((quarterTurns * Math.PI) / 2);
  ctx.drawImage(src, -w / 2, -hgt / 2);
  return c;
}

export async function openCropper(file) {
  const original = await loadBitmap(file);
  let src = original;
  let turns = 0;

  const canvas = h('canvas', { class: 'crop-canvas', 'aria-label': 'Rajausalue' });
  const zoom = h('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': 'Zoomaus' });
  const V = () => canvas.clientWidth || 300; // näkymän koko CSS-pikseleinä
  let scale = 1; let minScale = 1; let ox = 0; let oy = 0;

  function reset() {
    minScale = V() / Math.min(src.width, src.height);
    scale = minScale;
    ox = (V() - src.width * scale) / 2;
    oy = (V() - src.height * scale) / 2;
    zoom.value = '1';
    draw();
  }

  function clamp() {
    const v = V();
    ox = Math.min(0, Math.max(v - src.width * scale, ox));
    oy = Math.min(0, Math.max(v - src.height * scale, oy));
  }

  function draw() {
    const v = V(); const dpr = devicePixelRatio || 1;
    canvas.width = canvas.height = Math.round(v * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, v, v);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, ox, oy, src.width * scale, src.height * scale);
  }

  function zoomTo(newScale, cx = V() / 2, cy = V() / 2) {
    newScale = Math.min(minScale * 4, Math.max(minScale, newScale));
    ox = cx - ((cx - ox) * newScale) / scale;
    oy = cy - ((cy - oy) * newScale) / scale;
    scale = newScale;
    zoom.value = String(scale / minScale);
    clamp(); draw();
  }

  zoom.addEventListener('input', () => zoomTo(minScale * Number(zoom.value)));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomTo(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // Vetäminen ja nipistys (pointer events, toimii hiirellä ja kosketuksella)
  const pts = new Map();
  let pinch = null;
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      ox += e.clientX - prev.x; oy += e.clientY - prev.y; clamp(); draw();
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = canvas.getBoundingClientRect();
      const cx = (a.x + b.x) / 2 - r.left; const cy = (a.y + b.y) / 2 - r.top;
      if (pinch) zoomTo(scale * (dist / pinch), cx, cy);
      pinch = dist;
    }
  });
  const end = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  return new Promise((resolve) => {
    let result = null;
    const d = openDialog({
      title: 'Rajaa kansikuva',
      className: 'crop-dialog',
      body: h('div', { class: 'cropper' },
        h('div', { class: 'crop-frame' }, canvas),
        h('p', { class: 'hint' }, 'Vedä kuvaa ja zoomaa niin, että kansi täyttää neliön.'),
        h('div', { class: 'crop-tools' },
          h('label', { class: 'zoom' }, h('span', {}, 'Zoomaus'), zoom),
          h('button', { class: 'btn', type: 'button', onclick: () => { turns = (turns + 1) % 4; src = turns ? rotated(original, turns) : original; reset(); } }, icon('rotate'), 'Kierrä'))),
      actions: [
        h('button', { class: 'btn', onclick: () => d.close() }, 'Peruuta'),
        h('button', {
          class: 'btn btn-primary',
          onclick: async (e) => {
            e.target.disabled = true;
            const crop = { x: -ox / scale, y: -oy / scale, size: V() / scale };
            result = await renderSquare(src, crop, FULL_SIZE);
            d.close();
          },
        }, icon('check'), 'Käytä kuvaa'),
      ],
      onClose: () => resolve(result),
    });
    requestAnimationFrame(reset);
    new ResizeObserver(() => { const s = scale / minScale; minScale = V() / Math.min(src.width, src.height); scale = minScale * s; clamp(); draw(); }).observe(canvas);
  });
}
