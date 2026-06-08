/**
 * Browser-only image prep for Tesseract: colored labels, glare, and small text
 * benefit from grayscale + contrast + optional binarization before OCR.
 */

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode image'));
    };
    img.src = url;
  });
}

/** Histogram for 0–255 gray values */
function buildHistogram(gray, len) {
  const h = new Uint32Array(256);
  for (let i = 0; i < len; i++) h[gray[i]]++;
  return h;
}

function otsuThreshold(gray, len) {
  const hist = buildHistogram(gray, len);
  const total = len;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

function grayToImageData(gray, w, h, rgba) {
  let p = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const v = gray[p++];
    rgba[i] = v;
    rgba[i + 1] = v;
    rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }
}

/**
 * @param {Blob} imageBlob
 * @param {{ variant?: 'binary' | 'soft', maxSide?: number }} [opts]
 * @returns {Promise<Blob>}
 */
export async function preprocessLabelImageForOcr(imageBlob, opts = {}) {
  const variant = opts.variant ?? 'binary';
  const maxSide = opts.maxSide ?? 1800;

  const img = await loadImage(imageBlob);
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error('Invalid image dimensions');

  const scale = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const n = w * h;
  const gray = new Uint8Array(n);

  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  }

  // Percentile stretch (robust on colored backgrounds)
  const sorted = Array.from(gray).sort((a, b) => a - b);
  const lo = sorted[Math.floor(n * 0.02)] ?? 0;
  const hi = sorted[Math.floor(n * 0.98)] ?? 255;
  const range = Math.max(1, hi - lo);
  for (let p = 0; p < n; p++) {
    let v = ((gray[p] - lo) / range) * 255;
    gray[p] = Math.max(0, Math.min(255, Math.round(v)));
  }

  // Mild contrast curve
  const c = variant === 'soft' ? 1.15 : 1.28;
  for (let p = 0; p < n; p++) {
    let v = (gray[p] - 128) * c + 128;
    gray[p] = Math.max(0, Math.min(255, Math.round(v)));
  }

  if (variant === 'soft') {
    grayToImageData(gray, w, h, d);
    ctx.putImageData(imageData, 0, 0);
    return new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
  }

  // binary: Otsu + ensure dark text on white background for Tesseract
  const thr = otsuThreshold(gray, n);
  const bin = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    bin[p] = gray[p] > thr ? 255 : 0;
  }
  let dark = 0;
  for (let p = 0; p < n; p++) {
    if (bin[p] === 0) dark++;
  }
  if (dark > n / 2) {
    for (let p = 0; p < n; p++) bin[p] = 255 - bin[p];
  }

  for (let p = 0; p < n; p++) gray[p] = bin[p];
  grayToImageData(gray, w, h, d);
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
