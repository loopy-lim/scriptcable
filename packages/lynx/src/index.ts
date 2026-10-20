/**
 * @scriptcable/lynx — Lynx (https://lynxjs.org) adapter.
 *
 * Native module: packages/lynx/cpp links lib{name}.a (see cpp/CMakeLists.txt).
 * Wire ScriptcableRspackPlugin in lynx.config.ts / rsbuild.config.ts.
 *
 * Lynx apps are bundled with Rspeedy (Rsbuild). Use @scriptcable/webpack (Rspack)
 * or @scriptcable/vite-equivalent Rsbuild plugin to compile the core, then load
 * WASM in the Lynx JS runtime with a WASI polyfill.
 */
import type { EngineClient, ScriptcableProfile } from '@scriptcable/types';
import { ScriptcableError } from '@scriptcable/types';
export { loadWasmModule } from '@scriptcable/core/wasm';

export type LynxBridge = {
  call(exportName: string, args: unknown[]): unknown | Promise<unknown>;
};

export function createLynxEngine(bridge: LynxBridge, profile?: ScriptcableProfile): EngineClient {
  const known = profile ? new Set(profile.exports.map((e) => e.export)) : null;
  return {
    supports: { sync: true },
    async invoke(command, args) {
      if (known && !known.has(command)) {
        throw new ScriptcableError('UNKNOWN_EXPORT', command);
      }
      const list = Array.isArray(args) ? args : args === undefined ? [] : [args];
      return bridge.call(command, list);
    },
  };
}

/** Rsbuild/Rspeedy config helper — wires @scriptcable/webpack plugin. */
export function lynxScriptcableRsbuildPlugin(options: {
  configPath?: string;
  outDir?: string;
}): { name: string; options: typeof options } {
  return { name: 'scriptcable:lynx-rsbuild', options };
}
