/**
 * Drop-in E2E for Metro: a REAL Metro build (react-native 0.88 /
 * metro 0.87) must resolve the entry import onto the generated RN drop-in.
 * Asserted on the serialized bundle:
 *
 *   - the drop-in / TurboModule code is in the graph (TurboModuleRegistry
 *     bridge strings from NativeCable + the bridge client)
 *   - the TypeScript entry source is NOT (its greet template literal only
 *     exists in the original core)
 *
 * Run after `scriptcable build --hosts react-native` (build:core does it).
 */
import Metro from 'metro';
import metroConfigPkg from '@react-native/metro-config';
import { withScriptcableMetro } from '@scriptcable/react-native/metro';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '../..');
const entry = join(root, 'src', 'rn-entry.ts');

// RN 0.88: getDefaultConfig replaced loadMetroConfig
const baseConfig = await metroConfigPkg.getDefaultConfig(root);
baseConfig.projectRoot = root;
baseConfig.watchFolders = [root, repoRoot];
const config = withScriptcableMetro(baseConfig, {
  cwd: root,
  entry: '../calculator-core/src/core.ts',
});
if (!config.resolver?.resolveRequest) throw new Error('withScriptcableMetro did not wire a resolveRequest');

const out = join(mkdtempSync(join(tmpdir(), 'sc-metro-')), 'index.bundle');
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
// TurboModuleRegistry.getEnforcing comes from NativeCable.ts, reached only
// through the drop-in (bridge client + module spec)
if (!bundle.includes('getEnforcing')) {
  throw new Error('drop-in interception OFF — no TurboModule bridge (NativeCable) in the bundle');
}
console.log('metro drop-in smoke OK — bundle includes the RN drop-in bridge,', bundle.length, 'bytes');
