/**
 * Performance regression gate: times the native call path (the ~70 ns
 * contract that the whole project exists to protect) and compares against
 * the committed per-platform baseline.
 *
 * The tolerance is deliberately generous (default 2.5×) — shared CI runners
 * are noisy; the gate catches GROSS call-path regressions (e.g. an extra
 * async hop or a lost fast path), not ±10% jitter.
 *
 *   bun scripts/bench-gate.ts            # compare against the baseline
 *   bun scripts/bench-gate.ts --update   # rewrite the baseline from this run
 *
 * Prereq: bun run --filter @scriptcable/example-bench-core build
 */
import { loadNativeFromOutDir } from '@scriptcable/core/native';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exampleRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(exampleRoot, '..', '..');
const outDir = join(exampleRoot, '.scriptcable');
const baselinePath = join(exampleRoot, 'scripts', 'bench-baseline.json');
const TOLERANCE = 2.5;

type Baseline = Record<string, Record<string, number>>; // platform → workload → ns/call median

function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

function medianNsPerCall(fn: () => unknown, iterations: number, batches = 7): number {
  // warmup
  for (let i = 0; i < 10_000; i++) fn();
  const samples: number[] = [];
  for (let b = 0; b < batches; b++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    samples.push((ms * 1e6) / iterations); // ns per call
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

async function main(): Promise<void> {
  const update = process.argv.includes('--update');
  const client = await loadNativeFromOutDir(outDir);
  const profile = JSON.parse(await readFile(join(outDir, 'profile.json'), 'utf8'));
  const names = profile.exports.map((e: { export: string }) => e.export);
  const workloads = names.filter((n: string) => n === 'ping' || n === 'add');
  if (!workloads.length) throw new Error(`bench-core has no ping/add exports (got: ${names.join(', ')}) — check examples/bench-core/src/core.ts`);

  const results: Record<string, number> = {};
  for (const name of workloads) {
    results[name] = Math.round(medianNsPerCall(() => client.call(name, 3, 4), 200_000));
  }

  const platform = platformKey();
  if (update) {
    const baseline: Baseline = {};
    try {
      Object.assign(baseline, JSON.parse(await readFile(baselinePath, 'utf8')));
    } catch {
      /* first baseline */
    }
    baseline[platform] = results;
    await writeFile(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`baseline updated for ${platform}:`, JSON.stringify(results));
    return;
  }

  let baseline: Baseline = {};
  try {
    baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  } catch {
    throw new Error(`no baseline at ${baselinePath} — run with --update on a quiet machine first`);
  }
  const expected = baseline[platform];
  if (!expected) {
    console.log(`bench-gate: no baseline for ${platform} (have: ${Object.keys(baseline).join(', ')}) — skipping`);
    return;
  }
  let failed = false;
  for (const [name, ns] of Object.entries(results)) {
    const limit = (expected[name] ?? ns) * TOLERANCE;
    const ok = ns <= limit;
    console.log(`bench-gate ${platform}/${name}: ${ns} ns/call (baseline ${expected[name] ?? '—'}, limit ×${TOLERANCE} = ${Math.round(limit)}) ${ok ? 'OK' : 'REGRESSION'}`);
    if (!ok) failed = true;
  }
  if (failed) process.exit(1);
}

await main();
