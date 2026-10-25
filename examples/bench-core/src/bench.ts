/**
 * scriptcable benchmark — native (bun:ffi) vs wasm (WASI) on this machine.
 *
 * Workloads:
 *   ping          — pure call overhead (no work)
 *   add           — tiny f64 arithmetic
 *   fib(30)       — CPU-heavy iterative loop
 *   repeat(s,100) — string marshal round-trip (alloc + copy both ways)
 */
import { bench, formatTable, formatComparison, type BenchResult, type CompareRow } from '@scriptcable/testing';
import { loadNativeFromOutDir } from '@scriptcable/core/native';
import { loadWasmModule } from '@scriptcable/core/wasm';
import { createMinimalWasi } from '@scriptcable/core/wasi';
import { createBatchWire } from '@scriptcable/core/batch';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../.scriptcable');

async function timeColdAndWarmBuild(): Promise<{ coldMs: number; warmMs: number; cachedMs: number }> {
  const { spawnSync } = await import('node:child_process');
  const run = (args: string[]): number => {
    const t0 = Number(process.hrtime.bigint());
    const r = spawnSync('bun', ['run', 'build', ...args], { cwd: join(outDir, '..'), stdio: 'ignore' });
    if (r.status !== 0) throw new Error(`build failed: ${args.join(' ')}`);
    return (Number(process.hrtime.bigint()) - t0) / 1e6;
  };
  // cold — wipe outDir, full scriptc compile + link
  const { rm } = await import('node:fs/promises');
  await rm(outDir, { recursive: true, force: true });
  const coldMs = run([]);
  // warm — cache hit
  const warmMs = run([]);
  // cached with codegen skip (identical content)
  const cachedMs = run([]);
  return { coldMs, warmMs, cachedMs };
}

async function main(): Promise<void> {
  const native = await loadNativeFromOutDir(outDir);
  const profile = JSON.parse(await readFile(join(outDir, 'profile.json'), 'utf8'));
  const wasmBytes = await readFile(join(outDir, 'bench.wasm'));
  const wasm = await loadWasmModule(wasmBytes, {
    profile,
    wasi: createMinimalWasi(),
  });

  console.error('warming up engines…');
  native.call('fib', 10);
  wasm.call('fib', 10);

  // JS baseline for context (same workloads implemented in the host)
  const jsRows: BenchResult[] = [];
  let fibA = 0.0;
  let fibB = 1.0;
  const jsWorkloads: Array<{ name: string; fn: () => unknown; iterations: number }> = [
    { name: 'js:ping', fn: () => 1, iterations: 2_000_000 },
    { name: 'js:add', fn: () => 20 + 22, iterations: 2_000_000 },
    {
      name: 'js:fib(30)',
      fn: () => {
        let a = 0.0;
        let b = 1.0;
        for (let i = 0; i < 30; i++) {
          const t = a + b;
          a = b;
          b = t;
        }
        return a;
      },
      iterations: 200_000,
    },
    {
      name: 'js:repeat(100)',
      fn: () => {
        let out = '';
        for (let i = 0; i < 100; i++) out += 'ab';
        return out;
      },
      iterations: 200_000,
    },
  ];
  for (const w of jsWorkloads) {
    jsRows.push(bench(w.name, w.fn, { iterations: w.iterations }));
  }
  fibA = fibA; // keep linters calm
  fibB = fibB;

  const scenarios: Array<{
    name: string;
    fn: (engine: typeof native) => unknown;
    iterations: number;
  }> = [
    { name: 'ping', fn: (e) => e.call('ping'), iterations: 2_000_000 },
    { name: 'add', fn: (e) => e.call('add', 20, 22), iterations: 2_000_000 },
    { name: 'fib(30)', fn: (e) => e.call('fib', 30), iterations: 200_000 },
    { name: 'repeat(100)', fn: (e) => e.call('repeat', 'ab', 100), iterations: 200_000 },
  ];

  const nativeRows: BenchResult[] = [];
  const wasmRows: BenchResult[] = [];
  const comparisons: CompareRow[] = [];

  for (const s of scenarios) {
    const n = bench(`native:${s.name}`, () => s.fn(native), { iterations: s.iterations });
    const w = bench(`wasm:${s.name}`, () => s.fn(wasm), { iterations: s.iterations });
    nativeRows.push(n);
    wasmRows.push(w);
    comparisons.push({ name: s.name, native: n, wasm: w, speedup: n.opsPerSec / w.opsPerSec });
  }

  console.log('\n== js baseline (host arithmetic) ==');
  console.log(formatTable(jsRows));
  console.log('\n== native (bun:ffi → libbench.dylib) ==');
  console.log(formatTable(nativeRows));
  console.log('\n== wasm (wasm32-wasi reactor) ==');
  console.log(formatTable(wasmRows));
  console.log('\n== native vs wasm ==');
  console.log(formatComparison(comparisons));

  // Batch — N calls across one boundary. The generated addon ships the
  // executive; the loaders' batch() is a sequential loop (documented
  // fallback, measured here for the honest comparison).
  const BATCH_N = 64;
  const batchEntries = Array.from(
    { length: BATCH_N },
    () => ['repeat', 'ab', 100] as [string, ...unknown[]],
  );
  const batchRows: string[] = [];
  batchRows.push('| workload | ns/op | vs single |');
  batchRows.push('| --- | --- | --- |');
  const batchSingle: Record<string, number> = {
    addon: 0,
    native: nativeRows.find((r) => r.name.endsWith('repeat(100)'))!.meanNs,
    wasm: wasmRows.find((r) => r.name.endsWith('repeat(100)'))!.meanNs,
  };

  const addonPath = join(outDir, `${profile.name}.node`);
  if (existsSync(addonPath)) {
    const req = createRequire(join(outDir, 'package.json'));
    const addon = req(addonPath) as Record<string, (...args: unknown[]) => unknown>;
    const exec = addon['__scriptcable_batch'] as
      | ((meta: Int32Array, args: Uint8Array) => Uint8Array)
      | undefined;
    const wire = createBatchWire(profile);
    if (typeof exec === 'function') {
      const single = bench('addon:repeat(100)', () => addon.repeat('ab', 100), { iterations: 200_000 });
      batchSingle.addon = single.meanNs;
      const whole = bench(
        'addon:repeat-batch(64)',
        () => {
          const { meta, args } = wire.encode(batchEntries);
          wire.decode(exec(meta, args));
        },
        { iterations: 3_000 },
      );
      const perOp = whole.meanNs / BATCH_N;
      batchRows.push(`| addon:repeat-batch(64) — executive | ${perOp.toFixed(0)} | ${(perOp / batchSingle.addon * 100).toFixed(0)}% |`);
      batchRows.push(`| addon:repeat(100) single (ref) | ${batchSingle.addon.toFixed(0)} | 100% |`);

      // Numeric batch — no string codec on the wire, only slot reads/writes.
      const numEntries = Array.from(
        { length: BATCH_N },
        () => ['add', 20, 22] as [string, ...unknown[]],
      );
      const numSingle = bench('addon:add', () => addon.add(20, 22), { iterations: 2_000_000 });
      const numWhole = bench(
        'addon:add-batch(64)',
        () => {
          const { meta, args } = wire.encode(numEntries);
          wire.decode(exec(meta, args));
        },
        { iterations: 20_000 },
      );
      const numPerOp = numWhole.meanNs / BATCH_N;
      batchRows.push(`| addon:add-batch(64) — executive | ${numPerOp.toFixed(1)} | ${(numPerOp / numSingle.meanNs * 100).toFixed(0)}% of add single (${numSingle.meanNs.toFixed(0)}) |`);
    } else {
      console.error('addon has no batch executive — rebuild with the current codegen');
    }
  }
  const nativeWhole = bench('native:repeat-batch(64)', () => native.batch(batchEntries), { iterations: 1_000 });
  const wasmWhole = bench('wasm:repeat-batch(64)', () => wasm.batch(batchEntries), { iterations: 1_000 });
  const nativeTransport = native.batchTransport === 'executive' ? 'host executive' : 'sequential fallback';
  batchRows.push(`| native:repeat-batch(64) — ${nativeTransport} | ${(nativeWhole.meanNs / BATCH_N).toFixed(0)} | ${(nativeWhole.meanNs / BATCH_N / batchSingle.native * 100).toFixed(0)}% |`);
  batchRows.push(`| wasm:repeat-batch(64) — sequential | ${(wasmWhole.meanNs / BATCH_N).toFixed(0)} | ${(wasmWhole.meanNs / BATCH_N / batchSingle.wasm * 100).toFixed(0)}% |`);

  console.log(`\n== batch (${BATCH_N} × repeat('ab',100) per call) ==`);
  console.log(batchRows.join('\n'));

  console.error('\nmeasuring build times (cold / warm-cache)…');
  const buildTimes = await timeColdAndWarmBuild();
  console.log('\n== build times ==');
  console.log(`| metric | ms |`);
  console.log(`| --- | --- |`);
  console.log(`| cold build (scriptc compile + clang link) | ${buildTimes.coldMs.toFixed(0)} |`);
  console.log(`| warm build (cache hit) | ${buildTimes.warmMs.toFixed(0)} |`);
  console.log(`| warm build repeat (cache + codegen skip) | ${buildTimes.cachedMs.toFixed(0)} |`);

  native.dispose();
  wasm.dispose();
}

await main();
