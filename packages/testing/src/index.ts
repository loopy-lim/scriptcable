import {
  snapshotFromConfig,
  diffContracts,
  formatDiff,
  loadConfig,
} from '@scriptca/core';
import type { ContractSnapshot, ScriptcaConfig } from '@scriptca/types';
import { readFile } from 'node:fs/promises';

export async function loadProjectConfig(path: string): Promise<ScriptcaConfig> {
  return loadConfig(JSON.parse(await readFile(path, 'utf8')));
}

export function assertContractCompatible(
  before: ContractSnapshot,
  after: ContractSnapshot,
): void {
  const d = diffContracts(before, after);
  if (d.breaking.length) {
    throw new Error(`Breaking contract changes:\n${formatDiff(d)}`);
  }
}

export { snapshotFromConfig, diffContracts, formatDiff };
