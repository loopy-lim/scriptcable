/**
 * The scriptca site's own core.
 *
 * Dogfood: `bun run build:core` compiles exactly this file to WebAssembly
 * (`scriptca build --target wasm --hosts browser`), and the vite plugin
 * redirects every `../core` import in the app onto the compiled client —
 * the Live demo section below runs these exports as native-speed WASM in
 * your browser, with zero call-site ceremony.
 */

/** Adds two numbers. */
export function add(a: number, b: number): number {
  return a + b;
}

/** Iterative fibonacci — a number-crunching round-trip. */
export function fib(n: number): number {
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return a;
}

/** Joins `times` copies of `text` — a string round-trip over the boundary. */
export function repeat(text: string, times: number): string {
  const parts: string[] = [];
  for (let i = 0; i < times; i++) {
    parts.push(text);
  }
  return parts.join(' / ');
}

/** Sums a byte buffer — Uint8Array marshaling. */
export function sumBytes(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
  }
  return sum;
}

/**
 * Sums 0..count-1 inside the core — one boundary crossing for lots of work.
 * Pair with the live demo's chatty `add` loop to show amortized cost.
 */
export function sumRange(count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += i;
  }
  return sum;
}

/** BT.601 luma grayscale — mutates RGBA in place, one buffer round-trip. */
export function grayscaleRgba(data: Uint8Array): Uint8Array {
  for (let i = 0; i < data.length; i += 4) {
    const y = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    data[i] = y;
    data[i + 1] = y;
    data[i + 2] = y;
  }
  return data;
}

/**
 * Radius-2 box blur on packed RGBA. Allocates an output buffer so each pixel
 * averages a fresh neighbourhood — enough arithmetic to amortize marshaling.
 */
export function boxBlurRgba(data: Uint8Array, width: number, height: number): Uint8Array {
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
}

/** Nearest-neighbour RGBA resize — classic thumbnail / downscale kernel. */
export function resizeNearestRgba(
  data: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
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
}

/**
 * Sobel edge magnitude into RGB (alpha preserved). 3×3 convolution — another
 * coarse boundary that stays compute-bound on mid-size frames.
 */
export function sobelRgba(data: Uint8Array, width: number, height: number): Uint8Array {
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
}

/** Greets someone by name. */
export function greet(name: string): string {
  return `hello, ${name}`;
}
