import { ScriptcaError } from '@scriptca/types';
/** JSON/IPC bridge: each export becomes invoke(`${prefix}${name}`, { args }). */
export function createTauriSidecarEngine(options) {
    const prefix = options.prefix ?? 'scriptca_';
    const known = new Set(options.profile.exports.map((e) => e.export));
    return {
        supports: { sync: false },
        async invoke(command, args) {
            if (!known.has(command)) {
                throw new ScriptcaError('UNKNOWN_EXPORT', `Unknown export ${command}`);
            }
            const list = Array.isArray(args) ? args : args === undefined ? [] : [args];
            return options.invoke(`${prefix}${command}`, { args: list });
        },
    };
}
/**
 * Webview WASM path — re-export loader; caller supplies a browser WASI polyfill.
 * Prefer generating clients with `scriptca build --hosts tauri`.
 */
export { loadWasmModule } from '@scriptca/core/wasm';
//# sourceMappingURL=index.js.map