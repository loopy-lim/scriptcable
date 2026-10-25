/**
 * Node-runtime string measurement — the CI share of the performance record
 * (local dev machines here have no node; see docs/plans/2026-10-25-batch-api.md).
 *
 * Measures the string-marshaling tiers under V8: the typed N-API addon
 * (single + batch executive), the generic-FFI fallback (koffi), the WASM
 * reactor (node:wasi), and the pure-JS baseline. Runs under Bun too (the
 * local smoke: same script, bun:ffi / minimal-WASI tiers) — label rows with
 * the runtime to keep receipts honest.
 *
 *   node scripts/bench-node.ts                 # table to stdout
 *   node scripts/bench-node.ts --out run.json  # + JSON artifact
 *
 * Prereq: bun run --filter @scriptcable/example-bench-core build
 */
import { bench, formatTable, type BenchResult } from '@scriptcable/testing';
import { loadNativeFromOutDir } from '@scriptcable/core/native';
import { loadWasmModule } from '@scriptcable/core/wasm';
import { createBatchWire } from '@scriptcable/core/batch';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.scriptcable');
const BATCH_N = 64;
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

type Row = { name: string; ns: number };

async function main(): Promise<void> {
  const profile = JSON.parse(await readFile(join(outDir, 'profile.json'), 'utf8')) as Parameters<
    typeof createBatchWire
  >[0];
  const rows: Row[] = [];
  const record = (name: string, r: BenchResult): void => {
    rows.push({ name: r.name, ns: Math.round(r.meanNs) });
  };

  // JS baseline — the floor every boundary pays against.
  record('js:repeat(100)', bench('js:repeat(100)', () => {
    let out = '';
    for (let i = 0; i < 100; i++) out += 'ab';
    return out;
  }, { iterations: 200_000 }));

  // Typed N-API addon — Node's fastest boundary.
  const addonPath = join(outDir, `${profile.name}.node`);
  const wire = createBatchWire(profile);
  const batchEntries = Array.from(
    { length: BATCH_N },
    () => ['repeat', 'ab', 100] as [string, ...unknown[]],
  );
  const numEntries = Array.from(
    { length: BATCH_N },
    () => ['add', 20, 22] as [string, ...unknown[]],
  );
  if (existsSync(addonPath)) {
    const req = createRequire(join(outDir, 'package.json'));
    const addon = req(addonPath) as Record<string, (...args: unknown[]) => unknown>;
    record('addon:ping', bench('addon:ping', () => addon.ping(), { iterations: 2_000_000 }));
    record('addon:add', bench('addon:add', () => addon.add(20, 22), { iterations: 2_000_000 }));
    record('addon:repeat(100)', bench('addon:repeat(100)', () => addon.repeat('ab', 100), { iterations: 200_000 }));
    const exec = addon['__scriptcable_batch'] as
      | ((meta: Int32Array, args: Uint8Array) => Uint8Array)
      | undefined;
    if (typeof exec === 'function') {
      const strBatch = bench(
        'addon:repeat-batch(64)',
        () => {
          const { meta, args } = wire.encode(batchEntries);
          wire.decode(exec(meta, args));
        },
        { iterations: 3_000 },
      );
      rows.push({ name: 'addon:repeat-batch(64) — per op', ns: Math.round(strBatch.meanNs / BATCH_N) });
      const numBatch = bench(
        'addon:add-batch(64)',
        () => {
          const { meta, args } = wire.encode(numEntries);
          wire.decode(exec(meta, args));
        },
        { iterations: 20_000 },
      );
      rows.push({ name: 'addon:add-batch(64) — per op', ns: Math.round(numBatch.meanNs / BATCH_N) });
    }
  } else {
    console.error(`addon not found at ${addonPath} — build first`);
  }

  // Generic-FFI fallback — koffi under Node (bun:ffi under Bun for the smoke).
  try {
    const native = await loadNativeFromOutDir(outDir);
    record(`${isBun ? 'bun:ffi' : 'koffi'}:repeat(100)`, bench('native:repeat(100)', () => native.call('repeat', 'ab', 100), { iterations: 100_000 }));
    const whole = bench('native:repeat-batch(64)', () => native.batch(batchEntries), { iterations: 1_000 });
    rows.push({ name: `native:repeat-batch(64) — per op (${native.batchTransport})`, ns: Math.round(whole.meanNs / BATCH_N) });
    native.dispose();
  } catch (e) {
    console.error(`native fallback unavailable: ${(e as Error).message.split('\n')[0]}`);
  }

  // WASM reactor — best-effort (node:wasi needs Node ≥ 24ish; failures skip).
  try {
    const wasmBytes = await readFile(join(outDir, `${profile.name}.wasm`));
    let wasi: Parameters<typeof loadWasmModule>[1]['wasi'];
    if (isBun) {
      const { createMinimalWasi } = await import('@scriptcable/core/wasi');
      wasi = createMinimalWasi();
    } else {
      const { WASI } = await import('node:wasi');
      const nodeWasi = new WASI({ version: 'preview1', returnOnExit: true }) as unknown as Parameters<typeof loadWasmModule>[1]['wasi'];
      wasi = {
        getImportObject: nodeWasi.getImportObject?.bind(nodeWasi),
        getImports: nodeWasi.getImports?.bind(nodeWasi),
        initialize: nodeWasi.initialize?.bind(nodeWasi),
        setMemory: (nodeWasi as { setMemory?: (m: unknown) => void }).setMemory?.bind(nodeWasi),
      };
    }
    const wasm = await loadWasmModule(wasmBytes, { profile, wasi });
    record('wasm:repeat(100)', bench('wasm:repeat(100)', () => wasm.call('repeat', 'ab', 100), { iterations: 100_000 }));
    const whole = bench('wasm:repeat-batch(64)', () => wasm.batch(batchEntries), { iterations: 1_000 });
    rows.push({ name: 'wasm:repeat-batch(64) — per op (sequential)', ns: Math.round(whole.meanNs / BATCH_N) });
    wasm.dispose();
  } catch (e) {
    console.error(`wasm tier unavailable: ${(e as Error).message.split('\n')[0]}`);
  }

  const runtime = isBun
    ? `bun ${process.versions.bun ?? ''} (node-compat ${process.version}) · ${process.platform}-${process.arch}`
    : `node ${process.version} · ${process.platform}-${process.arch}`;
  console.log(`\n## scriptcable string tiers — ${runtime}\n`);
  console.log('| workload | ns/op |');
  console.log('| --- | --- |');
  for (const r of rows) console.log(`| ${r.name} | ${r.ns} |`);

  const outArg = process.argv.indexOf('--out');
  if (outArg > 0) {
    const dest = process.argv[outArg + 1]!;
    await writeFile(dest, JSON.stringify({ runtime, rows }, null, 2) + '\n');
    console.error(`\nwritten: ${dest}`);
  }
}

await main();
