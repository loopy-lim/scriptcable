/**
 * @scriptca/react-native — bridge adapter.
 *
 * Verified here: typed bridge + unit tests.
 * Not verified on device: linking scriptc `.lib.a` via Nitro/JSI, or WASM runtimes.
 */
import type { EngineClient, ScriptcaProfile } from '@scriptca/types';
export type ReactNativeBridge = {
    call(exportName: string, args: unknown[]): unknown | Promise<unknown>;
    dispose?: () => void;
};
export declare function createReactNativeEngine(bridge: ReactNativeBridge, profile?: ScriptcaProfile): EngineClient & {
    call: ReactNativeBridge['call'];
};
/** Mock bridge for tests / Storybook. */
export declare function createMockBridge(impl: Record<string, (...args: unknown[]) => unknown>): ReactNativeBridge;
//# sourceMappingURL=index.d.ts.map