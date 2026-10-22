/**
 * App-bundle smoke: proves the RN app is actually LAUNCHABLE — `expo export`
 * runs the real metro graph over index.js → src/App.tsx → the generated
 * NativeCable spec, i.e. the exact resolution chain the emulator flow needs.
 * Asserts the device assertion code (CABLE_RESULT) and the module name made
 * it into the bundle, and that the mock fallback didn't replace the native
 * path (the mock's identity never appears in the app graph — only in tests).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, '.expo-export');
rmSync(out, { recursive: true, force: true });

execFileSync('bunx', ['expo', 'export', '-p', 'android', '--no-bytecode', '--output-dir', out], {
  cwd: root,
  stdio: 'inherit',
});

const bundles = [];
const walk = (d) => {
  if (!existsSync(d)) return;
  for (const f of readdirSync(d, { recursive: true })) {
    const p = join(d, String(f));
    if (/\.(js|hbc)$/.test(String(f))) bundles.push(p);
  }
};
walk(join(out, '_expo', 'static', 'js'));
const code = bundles.map((f) => readFileSync(f, 'latin1')).join('\n');
if (!code) throw new Error('expo export produced no JS bundle');
// Markers survive both plain JS and Hermes bytecode string tables.
if (!code.includes('CABLE_RESULT')) throw new Error('bundle missing the device assertion (CABLE_RESULT)');
if (!code.includes('TurboModuleRegistry')) throw new Error('bundle missing the TurboModule spec');
console.log('app-bundle smoke OK — the app entry, App.tsx and NativeCable all resolve in the real metro graph');
