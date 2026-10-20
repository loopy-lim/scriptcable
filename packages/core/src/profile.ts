import type { ScriptcableConfig, ScriptcableProfile } from '@scriptcable/types';
import { inferExportsFromSource } from './infer.js';

/** Build a scriptc library profile from scriptcable.json. */
export function configToProfile(config: ScriptcableConfig): ScriptcableProfile {
  const prefix = normalizePrefix(config.prefix ?? `${slug(config.name)}_`);
  const hasCallbacks = (config.callbacks?.length ?? 0) > 0;
  const profile: ScriptcableProfile = {
    profile_format: 1,
    name: config.name,
    entry: config.entry,
    emission: 'llvm',
    optimization: config.optimization ?? 'release',
    abi: {
      prefix,
      init_symbol: `${prefix}init`,
      sink_register_symbol: `${prefix}sink`,
      ...(hasCallbacks
        ? { callback_register_symbol: `${prefix}callback` }
        : {}),
    },
    exports: (config.exports ?? []).map((e) => ({
      export: e.name,
      symbol: `${prefix}${e.name}`,
      params: e.params,
      returns: e.returns,
    })),
  };
  if (config.callbacks?.length) {
    profile.callbacks = config.callbacks.map((c) => ({
      name: c.name,
      params: c.params,
      returns: c.returns,
    }));
  }
  return profile;
}

/**
 * Resolve a config into a complete profile: when `exports` is omitted (or
 * partially declared), infer the ABI surface from the TS entry source.
 * Explicit declarations win; inferred functions fill the rest.
 */
export async function resolveProfile(
  config: ScriptcableConfig,
  cwd: string,
): Promise<{ profile: ScriptcableProfile; inferred: boolean; skipped: Array<{ name: string; reason: string }> }> {
  if (config.exports && config.exports.length > 0) {
    return { profile: configToProfile(config), inferred: false, skipped: [] };
  }
  const { resolve } = await import('node:path');
  const entryAbs = resolve(cwd, config.entry);
  const { inferExportsFromFile } = await import('./infer.js');
  const { exports: found, skipped } = await inferExportsFromFile(entryAbs);
  if (found.length === 0) {
    throw new Error(
      `No ABI-mappable exports found in ${config.entry}. ` +
        (skipped.length
          ? `Skipped: ${skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}. `
          : '') +
        'Use exported functions with explicit primitive types, or declare exports in scriptcable.json.',
    );
  }
  const merged: ScriptcableConfig = { ...config, exports: found.map((f) => ({ name: f.name, params: f.params, returns: f.returns })) };
  const profile = configToProfile(merged);
  // carry paramNames + docs for codegen
  profile.exports = profile.exports.map((e) => {
    const src = found.find((f) => f.name === e.export);
    return src ? { ...e, paramNames: src.paramNames, doc: src.doc } : e;
  });
  return { profile, inferred: true, skipped };
}

export function normalizePrefix(prefix: string): string {
  const p = prefix.endsWith('_') ? prefix : `${prefix}_`;
  if (!/^[A-Za-z_][A-Za-z0-9_]*_$/.test(p)) {
    throw new Error(
      `Invalid ABI prefix "${prefix}". Use a C identifier ending with underscore (e.g. "calc_").`,
    );
  }
  return p;
}

function slug(name: string): string {
  return name
    .replace(/[@/]/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^_+/, '')
    .toLowerCase() || 'app';
}

export function loadConfig(raw: unknown): ScriptcableConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('scriptcable.json must be an object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== 'string' || !o.name) throw new Error('scriptcable.json: name is required');
  if (typeof o.entry !== 'string' || !o.entry) throw new Error('scriptcable.json: entry is required');
  if (o.exports !== undefined && (!Array.isArray(o.exports) || o.exports.length === 0)) {
    throw new Error('scriptcable.json: exports must be a non-empty array when present (or omit it to infer from the TS entry)');
  }
  return o as ScriptcableConfig;
}
