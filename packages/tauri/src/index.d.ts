/**
 * @scriptca/tauri — Tauri 2 adapter.
 *
 * Primary path: load the scriptc WASM reactor inside the webview (same as browser).
 * Secondary path: `createSidecarBridge` routes through `invoke` to a Rust command
 * or sidecar that hosts the native `.lib.a`.
 *
 * Full Tauri app linking of `.lib.a` was not end-to-end verified on this Linux box
 * (needs a Tauri project + linker). Unit tests cover the bridge shapes.
 */
import type { EngineClient, ScriptcaProfile } from '@scriptca/types';
export type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
export type TauriBridgeOptions = {
    invoke: TauriInvoke;
    /** Command prefix, default "scriptca_" */
    prefix?: string;
    profile: ScriptcaProfile;
};
/** JSON/IPC bridge: each export becomes invoke(`${prefix}${name}`, { args }). */
export declare function createTauriSidecarEngine(options: TauriBridgeOptions): EngineClient;
/**
 * Webview WASM path — re-export loader; caller supplies a browser WASI polyfill.
 * Prefer generating clients with `scriptca build --hosts tauri`.
 */
export { loadWasmModule } from '@scriptca/core/wasm';
//# sourceMappingURL=index.d.ts.map