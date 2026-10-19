import { ScriptcaError } from '@scriptca/types';
export function createReactNativeEngine(bridge, profile) {
    const known = profile ? new Set(profile.exports.map((e) => e.export)) : null;
    return {
        supports: { sync: true },
        call: bridge.call.bind(bridge),
        async invoke(command, args) {
            if (known && !known.has(command)) {
                throw new ScriptcaError('UNKNOWN_EXPORT', `Unknown export ${command}`);
            }
            const list = Array.isArray(args) ? args : args === undefined ? [] : [args];
            return bridge.call(command, list);
        },
        dispose() {
            bridge.dispose?.();
        },
    };
}
/** Mock bridge for tests / Storybook. */
export function createMockBridge(impl) {
    return {
        call(name, args) {
            const fn = impl[name];
            if (!fn)
                throw new ScriptcaError('UNKNOWN_EXPORT', name);
            return fn(...args);
        },
    };
}
//# sourceMappingURL=index.js.map