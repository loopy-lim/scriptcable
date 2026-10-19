import type { ScriptcaConfig, ScriptcaProfile } from '@scriptca/types';
export type ToolchainInfo = {
    scriptcBin: string;
    version: string;
    nodeVersion: string;
    hasZig: boolean;
    hasClang: boolean;
    zigPath?: string;
    clangPath?: string;
};
/** Resolve scriptc binary: local node_modules, then PATH. Auto-installs if missing. */
export declare function resolveScriptc(cwd?: string): Promise<string>;
export declare function scriptcVersion(bin: string): Promise<string>;
export declare function doctor(cwd?: string): Promise<ToolchainInfo>;
export type BuildOptions = {
    cwd?: string;
    /** wasm | native | both */
    target?: 'wasm' | 'native' | 'both';
    outDir?: string;
    env?: NodeJS.ProcessEnv;
};
export type BuildResult = {
    profilePath: string;
    wasmPath?: string;
    nativePath?: string;
    profile: ScriptcaProfile;
};
export declare function buildCore(config: ScriptcaConfig, options?: BuildOptions): Promise<BuildResult>;
export declare function readJsonFile<T>(path: string): Promise<T>;
//# sourceMappingURL=toolchain.d.ts.map