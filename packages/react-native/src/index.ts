/**
 * @scriptcable/react-native — React Native adapter.
 *
 * Three tiers of integration:
 *
 * 1. **Mock bridge** (tests / Storybook): `createMockBridge({ add: (a,b) => a+b })`
 * 2. **Typed engine**: `createReactNativeEngine(bridge, profile)` — wraps any
 *    bridge with the EngineClient contract + export validation.
 * 3. **TurboModule spec** (codegen): `scriptcable build --hosts react-native`
 *    generates a `NativeCable.ts` TurboModule spec + `cable.json` codegen
 *    config so the RN CLI can typecheck the native module end-to-end.
 *
 * WASM-on-RN is an opt-in extra (needs a WASI runtime like
 * react-native-quick-wasm); native linking stays the default.
 */
import type { EngineClient, ScriptcableProfile } from '@scriptcable/types';
import { ScriptcableError } from '@scriptcable/types';

export type ReactNativeBridge = {
  call(exportName: string, args: unknown[]): unknown | Promise<unknown>;
  dispose?: () => void;
};

export function createReactNativeEngine(
  bridge: ReactNativeBridge,
  profile?: ScriptcableProfile,
): EngineClient & { call: ReactNativeBridge['call'] } {
  const known = profile ? new Set(profile.exports.map((e) => e.export)) : null;
  return {
    supports: { sync: true },
    call: bridge.call.bind(bridge),
    async invoke(command: string, args?: unknown) {
      if (known && !known.has(command)) {
        throw new ScriptcableError('UNKNOWN_EXPORT', `Unknown export ${command}`);
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
export function createMockBridge(impl: Record<string, (...args: unknown[]) => unknown>): ReactNativeBridge {
  return {
    call(name, args) {
      const fn = impl[name];
      if (!fn) throw new ScriptcableError('UNKNOWN_EXPORT', name);
      return fn(...args);
    },
  };
}

/**
 * Bridge backed by React Native's TurboModuleRegistry.
 *
 * The native module must expose `call(exportName: string, argsJson: string): Promise<string>`
 * (JSON in/out — the shape `cable.json` codegen produces).
 */
export function createTurboModuleBridge(mod: {
  call(exportName: string, argsJson: string): Promise<string>;
}): ReactNativeBridge {
  return {
    async call(exportName, args) {
      const resultJson = await mod.call(exportName, JSON.stringify(args));
      const parsed = JSON.parse(resultJson) as { ok: true; value: unknown } | { ok: false; error: string };
      if (!parsed.ok) throw new ScriptcableError('NATIVE_ERROR', parsed.error);
      return parsed.value;
    },
  };
}

export type { ScriptcableNativeHost } from './native-host.js';
