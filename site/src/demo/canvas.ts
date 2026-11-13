/** Canvas + buffer helpers for the visual demo panels. */

/** Deterministic synthetic RGBA test frame — gradient, disc, and checker-ish noise. */
export function synthRgba(w: number, h: number, seed: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const cx0 = w / 2;
  const cy0 = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) << 2;
      const dx = x - cx0;
      const dy = y - cy0;
      const d2 = dx * dx + dy * dy;
      out[i] = (x * 3 + seed) & 255;
      out[i + 1] = (y * 5 + seed * 2) & 255;
      out[i + 2] = (((d2 / (w + 1)) | 0) + seed) & 255;
      out[i + 3] = 255;
      if (d2 < w * w * 0.05) {
        out[i] = 240;
        out[i + 1] = 90;
        out[i + 2] = 70;
      } else if ((x ^ y ^ seed) & 16) {
        out[i] = (out[i] + 40) & 255;
      }
    }
  }
  return out;
}

/** Snap a free-form size input to the common demo sides (128 / 256 / 512). */
export function snapSize(raw: number): number {
  if (raw <= 160) return 128;
  if (raw <= 320) return 256;
  return 512;
}

/** Blit an RGBA buffer into a canvas, sizing the canvas to the buffer. */
export function paintRgba(
  canvas: HTMLCanvasElement | null,
  pixels: Uint8Array,
  width: number,
  height: number,
): void {
  if (!canvas) return;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const copy = new Uint8ClampedArray(pixels.length);
  copy.set(pixels);
  ctx.putImageData(new ImageData(copy, width, height), 0, 0);
}

export function randomBytes(size: number): Uint8Array {
  const data = new Uint8Array(size);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(data);
  } else {
    for (let i = 0; i < size; i++) data[i] = Math.floor(Math.random() * 256);
  }
  return data;
}
