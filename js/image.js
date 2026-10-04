// Kansikuvien käsittely: EXIF-kierto, rajaus neliöksi, pienennys ja tunniste.

export const FULL_SIZE = 1000;
export const THUMB_SIZE = 320;
const QUALITY = 0.85;

/** Lataa kuvan bitmapiksi niin, että kännykän kameran EXIF-suunta huomioidaan. */
export async function loadBitmap(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // Vanhat selaimet: <img> kääntää EXIF:n automaattisesti
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function dims(src) {
  return { w: src.naturalWidth ?? src.width, h: src.naturalHeight ?? src.height };
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = QUALITY) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Kuvan tallennus epäonnistui'))), type, quality);
  });
}

/**
 * Piirtää neliön rajauksen (lähdekuvan koordinaateissa) annettuun kokoon.
 * @param {{x:number,y:number,size:number}} crop
 */
export async function renderSquare(src, crop, outSize = FULL_SIZE) {
  const { w, h } = dims(src);
  const size = Math.min(outSize, Math.round(crop.size));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = 'high';
  const x = Math.max(0, Math.min(crop.x, w - crop.size));
  const y = Math.max(0, Math.min(crop.y, h - crop.size));
  ctx.drawImage(src, x, y, crop.size, crop.size, 0, 0, size, size);
  return canvasToBlob(canvas);
}

/** Oletusrajaus: suurin keskitetty neliö. */
export function centerCrop(src) {
  const { w, h } = dims(src);
  const size = Math.min(w, h);
  return { x: (w - size) / 2, y: (h - size) / 2, size };
}

/** Tekee pikkukuvan valmiista (neliön muotoisesta) kansikuvasta. */
export async function makeThumb(blob) {
  const bmp = await loadBitmap(blob);
  return renderSquare(bmp, centerCrop(bmp), THUMB_SIZE);
}

/** Lyhyt sisältötunniste, jotta muuttunut kuva saa uuden tiedostonimen. */
export async function shortHash(blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf).slice(0, 5)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function coverPath(id, hash) {
  return `kannet/${id}-${hash}.jpg`;
}
