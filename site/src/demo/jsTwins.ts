/**
 * Plain-JS twins of the core exports — the baseline the compiled WASM core
 * is measured against. Same arithmetic as src/core.ts, hand-written so the
 * comparison stays honest (no cross-compilation shortcuts).
 */

export const jsAdd = (a: number, b: number): number => a + b;

export const jsFib = (n: number): number => {
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return a;
};

export const jsRepeat = (text: string, times: number): string => {
  const parts: string[] = [];
  for (let i = 0; i < times; i++) parts.push(text);
  return parts.join(' / ');
};

export const jsSumBytes = (data: Uint8Array): number => {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return sum;
};

export const jsSumRange = (count: number): number => {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += i;
  return sum;
};

export const jsGrayscaleRgba = (data: Uint8Array): Uint8Array => {
  for (let i = 0; i < data.length; i += 4) {
    const y = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    data[i] = y;
    data[i + 1] = y;
    data[i + 2] = y;
  }
  return data;
};

export const jsBoxBlurRgba = (data: Uint8Array, width: number, height: number): Uint8Array => {
  const w = width | 0;
  const h = height | 0;
  const out = new Uint8Array(data.length);
  const radius = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        let sy = y + dy;
        if (sy < 0) sy = 0;
        else if (sy >= h) sy = h - 1;
        const row = sy * w;
        for (let dx = -radius; dx <= radius; dx++) {
          let sx = x + dx;
          if (sx < 0) sx = 0;
          else if (sx >= w) sx = w - 1;
          const i = (row + sx) << 2;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          a += data[i + 3];
          n++;
        }
      }
      const o = (y * w + x) << 2;
      out[o] = (r / n) | 0;
      out[o + 1] = (g / n) | 0;
      out[o + 2] = (b / n) | 0;
      out[o + 3] = (a / n) | 0;
    }
  }
  return out;
};

export const jsResizeNearestRgba = (
  data: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array => {
  const sw = srcW | 0;
  const sh = srcH | 0;
  const dw = dstW | 0;
  const dh = dstH | 0;
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = ((y * sh) / dh) | 0;
    const srcRow = sy * sw;
    const dstRow = y * dw;
    for (let x = 0; x < dw; x++) {
      const sx = ((x * sw) / dw) | 0;
      const si = (srcRow + sx) << 2;
      const di = (dstRow + x) << 2;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return out;
};

export const jsSobelRgba = (data: Uint8Array, width: number, height: number): Uint8Array => {
  const w = width | 0;
  const h = height | 0;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let gx = 0;
      let gy = 0;
      for (let dy = -1; dy <= 1; dy++) {
        let sy = y + dy;
        if (sy < 0) sy = 0;
        else if (sy >= h) sy = h - 1;
        const row = sy * w;
        for (let dx = -1; dx <= 1; dx++) {
          let sx = x + dx;
          if (sx < 0) sx = 0;
          else if (sx >= w) sx = w - 1;
          const i = (row + sx) << 2;
          const luma = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
          const kx = dx === 0 ? 0 : dx * (2 - (dy === 0 ? 0 : 1));
          const ky = dy === 0 ? 0 : dy * (2 - (dx === 0 ? 0 : 1));
          gx += luma * kx;
          gy += luma * ky;
        }
      }
      let mag = gx < 0 ? -gx : gx;
      mag += gy < 0 ? -gy : gy;
      if (mag > 255) mag = 255;
      const o = (y * w + x) << 2;
      out[o] = mag;
      out[o + 1] = mag;
      out[o + 2] = mag;
      out[o + 3] = data[o + 3];
    }
  }
  return out;
};

export const jsMandelbrotRgba = (
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  scale: number,
  maxIter: number,
): Uint8Array => {
  const w = width | 0;
  const h = height | 0;
  const iters = Math.min(2048, Math.max(16, maxIter | 0));
  const out = new Uint8Array(w * h * 4);
  const ramp = [
    [10, 12, 36],
    [38, 21, 80],
    [122, 34, 116],
    [224, 88, 84],
    [249, 178, 61],
    [255, 246, 214],
  ];
  const stops = ramp.length;
  const halfW = w / 2;
  const halfH = h / 2;
  for (let py = 0; py < h; py++) {
    const ci = centerY + (py - halfH) * scale;
    for (let px = 0; px < w; px++) {
      const cr = centerX + (px - halfW) * scale;
      let zx = 0;
      let zy = 0;
      let zx2 = 0;
      let zy2 = 0;
      let i = 0;
      while (zx2 + zy2 <= 4 && i < iters) {
        zy = 2 * zx * zy + ci;
        zx = zx2 - zy2 + cr;
        zx2 = zx * zx;
        zy2 = zy * zy;
        i++;
      }
      const o = (py * w + px) << 2;
      if (i >= iters) {
        out[o] = 6;
        out[o + 1] = 7;
        out[o + 2] = 14;
      } else {
        const f = (i & 15) / 16 * stops;
        const i0 = f | 0;
        const i1 = (i0 + 1) % stops;
        const fr = f - i0;
        const a = ramp[i0];
        const b = ramp[i1];
        out[o] = a[0] + (b[0] - a[0]) * fr;
        out[o + 1] = a[1] + (b[1] - a[1]) * fr;
        out[o + 2] = a[2] + (b[2] - a[2]) * fr;
      }
      out[o + 3] = 255;
    }
  }
  return out;
};
