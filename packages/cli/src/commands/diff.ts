import { resolve } from 'node:path';
import {
  snapshotFromProfile,
  diffContracts,
  formatDiff,
  readJsonFile,
  resolveProfile,
  loadProjectConfig,
  loadConfigFile,
} from '@scriptcable/core';
import type { ContractSnapshot } from '@scriptcable/types';

export async function runDiff(opts: {
  cwd?: string;
  snapshot?: string;
  configPath?: string;
  failOnBreaking?: boolean;
}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const config = opts.configPath
    ? await loadConfigFile(resolve(cwd, opts.configPath), cwd)
    : (await loadProjectConfig(cwd)).config;
  const { profile } = await resolveProfile(config, cwd);
  const after = snapshotFromProfile(profile);
  const snapPath = resolve(cwd, opts.snapshot ?? '.scriptcable/contract.json');
  const before = await readJsonFile<ContractSnapshot>(snapPath);
  const diff = diffContracts(before, after);
  console.log(formatDiff(diff));
  console.log(`before=${before.hash} after=${after.hash}`);
  if (opts.failOnBreaking !== false && diff.breaking.length > 0) return 1;
  return 0;
}
