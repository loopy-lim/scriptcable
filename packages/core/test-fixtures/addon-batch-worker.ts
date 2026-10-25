/**
 * F-1 regression worker — runs batches against the process-shared addon from
 * a worker thread and reports the number of corrupt results. The addon's
 * result-block cursor must be per-thread (_Thread_local); the 2026-10-25
 * review reproduced ~95% corruption with a shared cursor across 4 workers.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { createBatchWire } from '../src/batch-wire.js';

const { addonPath, profile, batches } = workerData as {
  addonPath: string;
  profile: Parameters<typeof createBatchWire>[0];
  batches: number;
};
const req = createRequire(addonPath);
const addon = req(addonPath) as Record<string, (...args: unknown[]) => unknown>;
const exec = addon['__scriptcable_batch'] as (meta: Int32Array, args: Uint8Array) => Uint8Array;
const wire = createBatchWire(profile);

let corrupt = 0;
for (let i = 0; i < batches; i++) {
  const echoLen = (i % 64) * 32;
  const entries = [
    ['concat', 'w', String(i)],
    ['echo', 'z'.repeat(echoLen)],
  ] as never;
  try {
    const { meta, args } = wire.encode(entries);
    const results = wire.decode(exec(meta, args));
    if (results[0] !== `w|${i}` || results[1] !== 'z'.repeat(echoLen)) corrupt++;
  } catch {
    corrupt++;
  }
}
parentPort!.postMessage(corrupt);
