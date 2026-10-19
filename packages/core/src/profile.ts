import type { ScriptcaConfig, ScriptcaProfile } from '@scriptca/types';

/** Build a scriptc library profile from scriptca.json. */
export function configToProfile(config: ScriptcaConfig): ScriptcaProfile {
  const prefix = normalizePrefix(config.prefix ?? `${slug(config.name)}_`);
  const hasCallbacks = (config.callbacks?.length ?? 0) > 0;
  const profile: ScriptcaProfile = {
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
    exports: config.exports.map((e) => ({
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

export function loadConfig(raw: unknown): ScriptcaConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('scriptca.json must be an object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== 'string' || !o.name) throw new Error('scriptca.json: name is required');
  if (typeof o.entry !== 'string' || !o.entry) throw new Error('scriptca.json: entry is required');
  if (!Array.isArray(o.exports) || o.exports.length === 0) {
    throw new Error('scriptca.json: exports must be a non-empty array');
  }
  return o as ScriptcaConfig;
}
