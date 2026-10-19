import type { ScriptcaConfig } from '@scriptca/types';
export type CodegenTarget = 'node' | 'bun' | 'tauri' | 'react-native' | 'lynx' | 'browser';
export type CodegenResult = {
    files: Record<string, string>;
};
export declare function generateClients(config: ScriptcaConfig, targets: CodegenTarget[], opts?: {
    wasmFileName?: string;
}): CodegenResult;
//# sourceMappingURL=codegen.d.ts.map