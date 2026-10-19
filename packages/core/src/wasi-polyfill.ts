/**
 * Minimal WASI Preview 1 polyfill for scriptc library reactors in the browser.
 * Implements only the imports scriptc cores typically need (no filesystem).
 */
export type WasiPolyfill = {
  getImportObject(): WebAssembly.Imports;
  initialize(instance: WebAssembly.Instance): void;
};

export function createMinimalWasi(): WasiPolyfill {
  let memory: WebAssembly.Memory | undefined;
  const wasi: Record<string, (...args: number[]) => number> = {
    environ_sizes_get(environCountPtr: number, environBufSizePtr: number) {
      const view = new DataView(memory!.buffer);
      view.setUint32(environCountPtr, 0, true);
      view.setUint32(environBufSizePtr, 0, true);
      return 0;
    },
    environ_get(_environ: number, _environBuf: number) {
      return 0;
    },
    clock_time_get(_id: number, _precision: number, timePtr: number) {
      const ns = BigInt(Date.now()) * 1_000_000n;
      const view = new DataView(memory!.buffer);
      view.setBigUint64(timePtr, ns, true);
      return 0;
    },
    proc_exit(code: number) {
      throw new Error(`WASI proc_exit(${code})`);
    },
    fd_write() {
      return 0;
    },
    fd_close() {
      return 0;
    },
    fd_seek() {
      return 0;
    },
    fd_read() {
      return 0;
    },
  };

  return {
    getImportObject() {
      return { wasi_snapshot_preview1: wasi };
    },
    initialize(instance: WebAssembly.Instance) {
      memory = instance.exports.memory as WebAssembly.Memory;
      const init = instance.exports._initialize as (() => void) | undefined;
      if (typeof init === 'function') init();
    },
  };
}
