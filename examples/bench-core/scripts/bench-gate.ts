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
import { createBatchWire } from '@scriptcable/core/batch';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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
  // repeat guards the string-marshaling contract (~0.6-1.1 µs/call) — the
  // boundary-marshaling round (2026-10-25) tuned this path; the baseline is
  // its post-optimization floor. The DELIVERED Bun tier routes marshaled
  // exports through the N-API addon — guard that path too when built.
  if (names.includes('repeat')) {
    results['repeat'] = Math.round(medianNsPerCall(() => client.call('repeat', 'ab', 100), 100_000));
    const BATCH_N = 64;
    const batchEntries = Array.from(
      { length: BATCH_N },
      () => ['repeat', 'ab', 100] as [string, ...unknown[]],
    );
    const addonPath = join(outDir, `${profile.name}.node`);
    if (existsSync(addonPath)) {
      const req = createRequire(join(outDir, 'package.json'));
      const addon = req(addonPath) as Record<string, (...args: unknown[]) => unknown>;
      results['repeat-addon'] = Math.round(medianNsPerCall(() => addon.repeat('ab', 100), 100_000));
      // The batch executive — 64 × repeat('ab',100) across one crossing,
      // recorded per-op (encode + executive + decode ÷ 64). Steady-state:
      // entries are built once, matching the amortized calling pattern.
      const exec = addon['__scriptcable_batch'] as
        | ((meta: Int32Array, args: Uint8Array) => Uint8Array)
        | undefined;
      if (typeof exec === 'function') {
        const wire = createBatchWire(profile);
        const perBatch = medianNsPerCall(() => {
          const { meta, args } = wire.encode(batchEntries);
          wire.decode(exec(meta, args));
        }, 20_000);
        results['repeat-batch'] = Math.round(perBatch / BATCH_N);
      }
    }
    // Host (.so) executive — same wire, ffi/koffi dispatch. The loader routes
    // marshaled batches through it when linked (sequential fallback value
    // otherwise; the baseline records whichever this build shipped).
    results['repeat-batch-so'] = Math.round(
      medianNsPerCall(() => client.batch(batchEntries), 20_000) / BATCH_N,
    );
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
