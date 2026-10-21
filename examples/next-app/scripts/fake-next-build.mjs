import { withScriptcable, scriptcableBuild, withScriptcableAsync } from '@scriptcable/next';
import { access } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { sharedLibraryFileName } from '@scriptcable/core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gen = await scriptcableBuild({ cwd: root });
await access(join(root, '.scriptcable', sharedLibraryFileName('calculator')));

// Drop-in flavors are emitted for both graphs
await access(join(root, '.scriptcable', 'generated', 'dropin', 'browser.ts'));
await access(join(root, '.scriptcable', 'generated', 'dropin', 'node.ts'));

const cfg = withScriptcable({ reactStrictMode: true });
if (typeof cfg.webpack !== 'function') throw new Error('missing webpack hook');

async function runGraph(isServer) {
  await new Promise((resolve, reject) => {
    const webpackConfig = { plugins: [], resolve: {} };
    cfg.webpack(webpackConfig, { isServer });
    const gate = webpackConfig.resolve.plugins?.[0];
    if (!gate) throw new Error(`isServer=${isServer}: missing drop-in resolve gate`);
    const buildPlugin = webpackConfig.plugins[0];
    let hook = null;
    buildPlugin.apply({
      context: root,
      hooks: { beforeCompile: { tapPromise(_name, fn) { hook = fn; } } },
    });
    hook().then(() => {
      // After the build, the gate must wire the redirect (gate goes live).
      let tapped = 0;
      gate.apply({
        ensureHook: (n) => ({ hook: n }),
        getHook: () => ({ tapAsync: () => { tapped += 1; } }),
        doResolve: () => {},
      });
      if (tapped !== 1) throw new Error(`isServer=${isServer}: gate did not wire the redirect`);
      resolve();
    }).catch(reject);
  });
}
await runGraph(false); // client graph → browser drop-in
await runGraph(true); // server graph → node drop-in

// Turbopack alias config is produced by the async variant
const turboCfg = await withScriptcableAsync({ reactStrictMode: true }, { cwd: root });
const alias = turboCfg.turbopack?.resolveAlias?.[join(root, 'src', 'core.ts')]
  ?? turboCfg.turbopack?.resolveAlias?.[join(root, '..', 'calculator-core', 'src', 'core.ts')];
if (!alias || !alias.includes('dropin')) throw new Error('turbopack.resolveAlias missing or wrong: ' + JSON.stringify(turboCfg.turbopack));

console.log('next build wiring OK', gen);
