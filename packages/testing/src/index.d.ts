import { snapshotFromConfig, diffContracts, formatDiff } from '@scriptca/core';
import type { ContractSnapshot, ScriptcaConfig } from '@scriptca/types';
export declare function loadProjectConfig(path: string): Promise<ScriptcaConfig>;
export declare function assertContractCompatible(before: ContractSnapshot, after: ContractSnapshot): void;
export { snapshotFromConfig, diffContracts, formatDiff };
//# sourceMappingURL=index.d.ts.map