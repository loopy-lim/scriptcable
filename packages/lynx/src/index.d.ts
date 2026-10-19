/**
 * @scriptca/lynx — Lynx (https://lynxjs.org) adapter.
 *
 * Lynx apps are bundled with Rspeedy (Rsbuild). Use @scriptca/webpack (Rspack)
 * or @scriptca/vite-equivalent Rsbuild plugin to compile the core, then load
 * WASM in the Lynx JS runtime with a WASI polyfill.
 */
import type { EngineClient, ScriptcaProfile } from '@scriptca/types';
export { loadWasmModule } from '@scriptca/core/wasm';
export type LynxBridge = {
    call(exportName: string, args: unknown[]): unknown | Promise<unknown>;
};
export declare function createLynxEngine(bridge: LynxBridge, profile?: ScriptcaProfile): EngineClient;
/** Rsbuild/Rspeedy config helper — wires @scriptca/webpack plugin. */
export declare function lynxScriptcaRsbuildPlugin(options: {
    configPath?: string;
    outDir?: string;
}): {
    name: string;
    options: typeof options;
};
//# sourceMappingURL=index.d.ts.map