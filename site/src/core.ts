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

/** Greets someone by name. */
export function greet(name: string): string {
  return `hello, ${name}`;
}
