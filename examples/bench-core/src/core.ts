/** scriptcable bench core — workloads used by the performance benchmark suite. */

export function add(a: number, b: number): number {
  return a + b;
}

/** CPU-heavy: iterative fibonacci (f64 in / f64 out to keep the ABI simple). */
export function fib(n: number): number {
  let a = 0.0;
  let b = 1.0;
  for (let i = 0; i < n; i++) {
    const t = a + b;
    a = b;
    b = t;
  }
  return a;
}

/** String alloc round-trip: builds a string of n repeats. */
export function repeat(s: string, n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += s;
  }
  return out;
}

/** Latency ping — no work, measures pure call overhead. */
export function ping(): number {
  return 1;
}
