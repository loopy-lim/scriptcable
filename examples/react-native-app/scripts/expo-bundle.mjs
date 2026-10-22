/**
 * Drop-in E2E for Expo: a REAL Metro build using Expo's own default config
 * (@expo/metro-config getDefaultConfig — Expo's bundler IS Metro) must
 * resolve the entry import onto the generated RN drop-in. Same assertions
 * as metro-bundle.mjs:
 *
 *   - the drop-in / TurboModule bridge code is in the graph
 *   - the TypeScript entry source is NOT
 *
 * Run after `scriptcable build --hosts react-native` (build:core does it).
 */
import Metro from 'metro';
import { getDefaultConfig } from '@expo/metro-config';
import { withScriptcableMetro } from '@scriptcable/react-native/metro';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '../..');
const entry = join(root, 'src', 'rn-entry.ts');

// Expo's real default metro config (cacheStores, resolver extensions, …)
const baseConfig = await getDefaultConfig(root);
baseConfig.projectRoot = root;
baseConfig.watchFolders = [root, repoRoot];
// Expo's default polyfills resolve through the root react-native install's
// rn-get-polyfills — irrelevant for a resolver-level bundle smoke.
baseConfig.serializer = { ...baseConfig.serializer, getPolyfills: () => [] };
const config = withScriptcableMetro(baseConfig, {
  cwd: root,
  entry: '../calculator-core/src/core.ts',
});
if (!config.resolver?.resolveRequest) throw new Error('withScriptcableMetro did not wire a resolveRequest');

const out = join(mkdtempSync(join(tmpdir(), 'sc-expo-')), 'index.bundle');
const { code } = await Metro.runBuild(config, {
  entry,
  platform: 'ios',
  dev: false,
  minify: false,
  out,
  sourceMap: false,
});
const bundle = code ?? (await import('node:fs')).readFileSync(out, 'utf8');

if (bundle.includes('hello, ${name}')) {
  throw new Error('drop-in interception OFF — the TS entry source is in the bundle');
}
if (!bundle.includes('getEnforcing')) {
  throw new Error('drop-in interception OFF — no TurboModule bridge (NativeCable) in the bundle');
}
console.log('expo drop-in smoke OK — bundle includes the RN drop-in bridge,', bundle.length, 'bytes');
