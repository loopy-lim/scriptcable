import type { ContractDiff, ContractSnapshot, ScriptcaConfig, ScriptcaProfile } from '@scriptca/types';
export declare function snapshotFromProfile(profile: ScriptcaProfile): ContractSnapshot;
export declare function snapshotFromConfig(config: ScriptcaConfig): ContractSnapshot;
/** Diff two snapshots. Breaking = removed or changed signatures. */
export declare function diffContracts(before: ContractSnapshot, after: ContractSnapshot): {
    breaking: ContractDiff[];
    nonBreaking: ContractDiff[];
};
export declare function formatDiff(diff: {
    breaking: ContractDiff[];
    nonBreaking: ContractDiff[];
}): string;
//# sourceMappingURL=contract.d.ts.map