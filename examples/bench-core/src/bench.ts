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
import { readFile } from 'node:fs/promises';
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
