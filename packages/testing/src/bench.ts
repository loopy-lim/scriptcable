/**
 * Micro benchmark utilities for scriptcable engines.
 * Latency (mean/p50/p99 in ns) and throughput (ops/sec) with warmup.
 */

export type BenchResult = {
  name: string;
  iterations: number;
  /** nanoseconds per op */
  meanNs: number;
  p50Ns: number;
  p99Ns: number;
  minNs: number;
  maxNs: number;
  opsPerSec: number;
};

export type BenchOptions = {
  /** Warmup iterations before timing (default 10_000) */
  warmup?: number;
  /** Timed iterations (default 1_000_000 for cheap ops) */
  iterations?: number;
};

function nowNs(): number {
  return Number(process.hrtime.bigint());
}

export function bench(
  name: string,
  fn: () => unknown,
  options: BenchOptions = {},
): BenchResult {
  const iterations = options.iterations ?? 1_000_000;
  const warmup = options.warmup ?? 10_000;

  for (let i = 0; i < warmup; i++) fn();

  // Collect per-op samples in batches to keep overhead low
  const samples: number[] = [];
  const batchSize = Math.max(1, Math.floor(iterations / 1000));
  const batches = Math.ceil(iterations / batchSize);

  const start = nowNs();
  for (let b = 0; b < batches; b++) {
    const t0 = nowNs();
    for (let i = 0; i < batchSize; i++) fn();
    const t1 = nowNs();
    samples.push((t1 - t0) / batchSize);
  }
  const total = nowNs() - start;

  samples.sort((a, b) => a - b);
  const sum = samples.reduce((acc, s) => acc + s, 0);
  const mean = sum / samples.length || total / iterations;
  const pick = (q: number): number => {
    if (samples.length === 0) return mean;
    const idx = Math.min(samples.length - 1, Math.max(0, Math.floor(q * samples.length)));
    return samples[idx]!;
  };

  return {
    name,
    iterations,
    meanNs: Math.round(mean * 100) / 100,
    p50Ns: Math.round(pick(0.5) * 100) / 100,
    p99Ns: Math.round(pick(0.99) * 100) / 100,
    minNs: Math.round(samples[0] ?? mean),
    maxNs: Math.round(samples[samples.length - 1] ?? mean),
    opsPerSec: Math.round(1e9 / mean),
  };
}

export type CompareRow = {
  name: string;
  native: BenchResult;
  wasm: BenchResult;
  /** native ops/sec ÷ wasm ops/sec (>1 → native faster) */
  speedup: number;
};

export function formatTable(rows: BenchResult[]): string {
  const header = ['benchmark', 'iter', 'mean', 'p50', 'p99', 'ops/sec'];
  const units = (ns: number): string =>
    ns >= 1e6 ? `${(ns / 1e6).toFixed(2)}ms` : ns >= 1e3 ? `${(ns / 1e3).toFixed(2)}µs` : `${ns.toFixed(1)}ns`;
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.name} | ${r.iterations.toLocaleString()} | ${units(r.meanNs)} | ${units(r.p50Ns)} | ${units(r.p99Ns)} | ${r.opsPerSec.toLocaleString()} |`,
    );
  }
  return lines.join('\n');
}

export function formatComparison(rows: CompareRow[]): string {
  const lines = [
    '| benchmark | native mean | wasm mean | native ops/s | wasm ops/s | native ÷ wasm |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  const units = (ns: number): string =>
    ns >= 1e6 ? `${(ns / 1e6).toFixed(2)}ms` : ns >= 1e3 ? `${(ns / 1e3).toFixed(2)}µs` : `${ns.toFixed(1)}ns`;
  for (const r of rows) {
    lines.push(
      `| ${r.name} | ${units(r.native.meanNs)} | ${units(r.wasm.meanNs)} | ${r.native.opsPerSec.toLocaleString()} | ${r.wasm.opsPerSec.toLocaleString()} | ${r.speedup.toFixed(2)}x |`,
    );
  }
  return lines.join('\n');
}
