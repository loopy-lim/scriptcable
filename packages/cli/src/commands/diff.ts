import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  loadConfig,
  snapshotFromConfig,
  diffContracts,
  formatDiff,
  readJsonFile,
} from '@scriptca/core';
import type { ContractSnapshot } from '@scriptca/types';

export async function runDiff(opts: {
  cwd?: string;
  snapshot?: string;
  configPath?: string;
  failOnBreaking?: boolean;
}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(
    JSON.parse(await readFile(resolve(cwd, opts.configPath ?? 'scriptca.json'), 'utf8')),
  );
  const after = snapshotFromConfig(config);
  const snapPath = resolve(cwd, opts.snapshot ?? '.scriptca/contract.json');
  const before = await readJsonFile<ContractSnapshot>(snapPath);
  const diff = diffContracts(before, after);
  console.log(formatDiff(diff));
  console.log(`before=${before.hash} after=${after.hash}`);
  if (opts.failOnBreaking !== false && diff.breaking.length > 0) return 1;
  return 0;
}
