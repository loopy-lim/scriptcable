import type { ResolvedConfig, ScriptcableConfig, ScriptcableProfile } from '@scriptcable/types';
import { inferExportsFromSource } from './infer.js';
import { resolveNameEntry, slugPackageName } from './defaults.js';

/** Build a scriptc library profile from a fully-resolved config. */
export function configToProfile(config: ResolvedConfig): ScriptcableProfile {
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
 * Resolve a config into a complete profile. Zero-config friendly: when
 * `name`/`entry` are omitted they're inferred (package.json / standard
 * entry locations); when `exports` is omitted (or partially declared),
 * the ABI surface is inferred from the TS entry source.
 * Explicit declarations win; inferred values fill the rest.
 */
export async function resolveProfile(
  config: ScriptcableConfig,
  cwd: string,
): Promise<{ profile: ScriptcableProfile; inferred: boolean; skipped: Array<{ name: string; reason: string }> }> {
  const { config: resolvedResult } = await resolveNameEntry(config, cwd);
  const resolved = resolvedResult as ResolvedConfig;

  if (resolved.exports && resolved.exports.length > 0) {
    const profile = configToProfile(resolved);
    // Explicit declarations pin the ABI surface, but the source still holds
    // codegen-only metadata — merge paramNames/JSDoc by name so generated
    // clients (and drop-ins) keep the original parameter names and docs.
    try {
      const { resolve } = await import('node:path');
      const entryAbs = resolve(cwd, resolved.entry);
      const { inferExportsFromFile } = await import('./infer.js');
      const { exports: found } = await inferExportsFromFile(entryAbs);
      profile.exports = profile.exports.map((e) => {
        const src = found.find((f) => f.name === e.export);
        return src ? { ...e, paramNames: src.paramNames, doc: src.doc } : e;
      });
    } catch {
      /* source unavailable — positional arg names are fine */
    }
    return { profile, inferred: false, skipped: [] };
  }
  const { resolve } = await import('node:path');
  const entryAbs = resolve(cwd, resolved.entry);
  const { inferExportsFromFile } = await import('./infer.js');
  const { exports: found, skipped } = await inferExportsFromFile(entryAbs);
  if (found.length === 0) {
    throw new Error(
      `No ABI-mappable exports found in ${resolved.entry}. ` +
        (skipped.length
          ? `Skipped: ${skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}. `
          : '') +
        'Use exported functions with explicit primitive types, or declare exports in scriptcable.json.',
    );
  }
  const merged: ResolvedConfig = { ...(resolved as ResolvedConfig), exports: found.map((f) => ({ name: f.name, params: f.params, returns: f.returns })) };
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
  return slugPackageName(name);
}

export function loadConfig(raw: unknown): ScriptcableConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('scriptcable config must be an object');
  }
  const o = raw as Record<string, unknown>;
  // Zero-config: name/entry may be omitted (inferred at resolve time) —
  // but when provided they must be usable.
  if (o.name !== undefined && (typeof o.name !== 'string' || !o.name)) {
    throw new Error('scriptcable config: name must be a non-empty string when provided (or omit it to infer from package.json)');
  }
  if (o.entry !== undefined && (typeof o.entry !== 'string' || !o.entry)) {
    throw new Error('scriptcable config: entry must be a non-empty string when provided (or omit it to infer from standard locations)');
  }
  if (o.exports !== undefined && (!Array.isArray(o.exports) || o.exports.length === 0)) {
    throw new Error('scriptcable config: exports must be a non-empty array when present (or omit it to infer from the TS entry)');
  }
  return o as ScriptcableConfig;
}
