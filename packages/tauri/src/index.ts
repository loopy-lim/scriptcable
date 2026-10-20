/**
 * @scriptcable/tauri — Tauri 2 adapter (native-first).
 *
 * Preferred: link scriptc `.lib.a` inside your own Tauri Rust shell
 * (build script / cc crate) and expose commands via `invoke`.
 * `createTauriSidecarEngine` models that IPC.
 *
 * Opt-in: load WASM in the webview only when native linking is unavailable.
 */
import type { EngineClient, ScriptcaProfile } from '@scriptcable/types';
import { ScriptcaError } from '@scriptcable/types';

export type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export type TauriBridgeOptions = {
  invoke: TauriInvoke;
  prefix?: string;
  profile: ScriptcaProfile;
};

/** Native IPC bridge — each export becomes invoke(`${prefix}${name}`, { args }). */
export function createTauriSidecarEngine(options: TauriBridgeOptions): EngineClient {
  const prefix = options.prefix ?? 'scriptcable_';
  const known = new Set(options.profile.exports.map((e) => e.export));
  return {
    supports: { sync: false },
    async invoke(command: string, args?: unknown) {
      if (!known.has(command)) {
        throw new ScriptcaError('UNKNOWN_EXPORT', `Unknown export ${command}`);
      }
      const list = Array.isArray(args) ? args : args === undefined ? [] : [args];
      return options.invoke(`${prefix}${command}`, { args: list });
    },
  };
}

export { loadWasmModule } from '@scriptcable/core/wasm';
