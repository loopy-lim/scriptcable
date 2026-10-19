declare module 'bun:ffi' {
  export const FFIType: Record<string, unknown>;
  export function dlopen(
    path: string,
    symbols: Record<string, unknown>,
  ): { symbols: Record<string, (...args: never[]) => unknown> };
  export function ptr(buf: ArrayBufferView | ArrayBuffer): unknown;
  export function toArrayBuffer(addr: number | bigint, offset: number, length: number): ArrayBuffer;
}

declare module 'koffi' {
  const koffi: {
    load(path: string): { func(sig: string): (...args: unknown[]) => unknown };
    decode(ptr: unknown, type: string, len?: number): unknown;
    default?: typeof koffi;
  };
  export = koffi;
}
