/** @scriptca/types — shared EngineClient contract and errors. */

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
  returns: AbiClass;
};

export type CallbackDef = {
  name: string;
  params: AbiClass[];
  returns: AbiClass;
};

export type ScriptcaProfile = {
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

/** Project config (scriptca.json). */
export type ScriptcaConfig = {
  /** Package / project name */
  name: string;
  /** Core entry relative to project root */
  entry: string;
  /** Symbol prefix for the ABI */
  prefix?: string;
  /** Declared exports (source of truth for codegen + profile) */
  exports: Array<{
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
  /** Default artifact kind */
  target?: 'wasm' | 'native' | 'both';
  optimization?: 'release' | 'dev' | 'speed';
};

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

export class ScriptcaError extends Error {
  readonly code: string;
  readonly hint?: string;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = 'ScriptcaError';
    this.code = code;
    this.hint = hint;
  }
}

export class ScriptcaToolchainError extends ScriptcaError {
  constructor(message: string, hint?: string) {
    super('SCRIPTC_TOOLCHAIN', message, hint);
    this.name = 'ScriptcaToolchainError';
  }
}

export class ScriptcaContractError extends ScriptcaError {
  constructor(message: string, hint?: string) {
    super('CONTRACT', message, hint);
    this.name = 'ScriptcaContractError';
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
