import { ScriptcaError } from '@scriptca/types';
export { loadWasmModule } from '@scriptca/core/wasm';
export function createLynxEngine(bridge, profile) {
    const known = profile ? new Set(profile.exports.map((e) => e.export)) : null;
    return {
        supports: { sync: true },
        async invoke(command, args) {
            if (known && !known.has(command)) {
                throw new ScriptcaError('UNKNOWN_EXPORT', command);
            }
            const list = Array.isArray(args) ? args : args === undefined ? [] : [args];
            return bridge.call(command, list);
        },
    };
}
/** Rsbuild/Rspeedy config helper — wires @scriptca/webpack plugin. */
export function lynxScriptcaRsbuildPlugin(options) {
    return { name: 'scriptca:lynx-rsbuild', options };
}
//# sourceMappingURL=index.js.map