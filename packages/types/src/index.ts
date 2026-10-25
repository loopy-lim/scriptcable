/** @scriptcable/types — shared EngineClient contract and errors. */

export type AbiClass =
  | 'f64'
  | 'f32'
  | 'bool'
  | 'u8'
  | 'u16'
  | 'u32'
  | 'i8'
  | 'i16'
  | 'i32'
  | 'i64'
  | 'u64'
  | 'string'
  | 'bytes'
  | 'cstring'
  | 'void';

export type ExportDef = {
  /** TypeScript export name */
  export: string;
  /** Native/Wasm symbol (usually `${prefix}${export}`) */
  symbol: string;
  params: AbiClass[];
  /** Source parameter names (from TS inference) — used by codegen. */
  paramNames?: string[];
  /** JSDoc summary carried from the TS source. */
  doc?: string;
  returns: AbiClass;
};

export type CallbackDef = {
  name: string;
  params: AbiClass[];
  returns: AbiClass;
};

/**
 * One batch call — `[exportName, ...args]`. A whole batch crosses the
 * boundary once (see createBatchWire and the generated clients' batch()).
 */
export type BatchEntry = [exportName: string, ...args: unknown[]];

export type ScriptcableProfile = {
  profile_format: 1 | 2;
  name: string;
  entry: string;
  emission: 'llvm';
  optimization?: 'release' | 'dev' | 'speed';
  abi: {
    prefix: string;
    init_symbol: string;
    sink_register_symbol: string;
    callback_register_symbol?: string;
    collect_symbol?: string | null;
    result_reset_symbol?: string | null;
  };
  exports: ExportDef[];
  callbacks?: CallbackDef[];
};

/**
 * Project config (scriptcable.config.ts / scriptcable.json).
 *
 * Zero-config: `name` and `entry` may be omitted — the build infers `name`
 * from package.json (falling back to the directory name) and `entry` from
 * standard locations (`src/core.ts` > `core.ts` > `src/index.ts` > `index.ts`).
 * Explicit values always win over inference.
 */
export type ScriptcableConfig = {
  /** Package / project name — inferred from package.json when omitted */
  name?: string;
  /** Core entry relative to project root — inferred from standard locations when omitted */
  entry?: string;
  /** Symbol prefix for the ABI */
  prefix?: string;
  /** Declared exports — when omitted, inferred from the TS entry source. */
  exports?: Array<{
    name: string;
    params: AbiClass[];
    returns: AbiClass;
  }>;
  callbacks?: Array<{
    name: string;
    params: AbiClass[];
    returns: AbiClass;
  }>;
  /** Output directory for artifacts + generated clients */
  outDir?: string;
  /** Default artifact kind (native is the default; wasm is opt-in for browsers) */
  target?: 'native' | 'wasm' | 'both';
  optimization?: 'release' | 'dev' | 'speed';
};

/**
 * A config whose required fields have been resolved — either read from the
 * config file or inferred from package.json / standard entry locations.
 * Produced by `resolveProjectConfig` / `resolveProfile`; required by
 * `configToProfile`, `buildCore`, and `generateClients`.
 */
export type ResolvedConfig = ScriptcableConfig & { name: string; entry: string };


export type EngineSupports = {
  cancel?: boolean;
  events?: boolean;
  channels?: boolean;
  batch?: boolean;
  sync?: boolean;
};

export type InvokeOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * Minimal host engine. Adapters implement this; generated clients call it.
 * For direct-ABI cores, prefer typed methods on the loaded instance instead.
 */
export interface EngineClient {
  invoke(command: string, args?: unknown, options?: InvokeOptions): Promise<unknown>;
  readonly supports?: EngineSupports;
  dispose?(): void | Promise<void>;
}

export class ScriptcableError extends Error {
  readonly code: string;
  readonly hint?: string;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = 'ScriptcableError';
    this.code = code;
    this.hint = hint;
  }
}

export class ScriptcableToolchainError extends ScriptcableError {
  constructor(message: string, hint?: string) {
    super('SCRIPTC_TOOLCHAIN', message, hint);
    this.name = 'ScriptcableToolchainError';
  }
}

export class ScriptcableContractError extends ScriptcableError {
  constructor(message: string, hint?: string) {
    super('CONTRACT', message, hint);
    this.name = 'ScriptcableContractError';
  }
}

export type ContractSnapshot = {
  schemaVersion: 1;
  name: string;
  entry: string;
  prefix: string;
  exports: ExportDef[];
  callbacks: CallbackDef[];
  /** Stable hash of the normalized surface */
  hash: string;
};

export type ContractDiff =
  | { kind: 'added'; export: string }
  | { kind: 'removed'; export: string }
  | { kind: 'changed'; export: string; before: string; after: string }
  | { kind: 'callback-added'; name: string }
  | { kind: 'callback-removed'; name: string }
  | { kind: 'callback-changed'; name: string; before: string; after: string };
