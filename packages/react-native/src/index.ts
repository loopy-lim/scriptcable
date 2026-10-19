/**
 * @scriptca/react-native — bridge adapter.
 *
 * Verified here: typed bridge + unit tests.
 * Not verified on device: linking scriptc `.lib.a` via Nitro/JSI, or WASM runtimes.
 */
import type { EngineClient, ScriptcaProfile } from '@scriptca/types';
import { ScriptcaError } from '@scriptca/types';

export type ReactNativeBridge = {
  call(exportName: string, args: unknown[]): unknown | Promise<unknown>;
  dispose?: () => void;
};

export function createReactNativeEngine(
  bridge: ReactNativeBridge,
  profile?: ScriptcaProfile,
): EngineClient & { call: ReactNativeBridge['call'] } {
  const known = profile ? new Set(profile.exports.map((e) => e.export)) : null;
  return {
    supports: { sync: true },
    call: bridge.call.bind(bridge),
    async invoke(command: string, args?: unknown) {
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
export function createMockBridge(impl: Record<string, (...args: unknown[]) => unknown>): ReactNativeBridge {
  return {
    call(name, args) {
      const fn = impl[name];
      if (!fn) throw new ScriptcaError('UNKNOWN_EXPORT', name);
      return fn(...args);
    },
  };
}

export type { ScriptcaNativeHost } from './native-host.js';
