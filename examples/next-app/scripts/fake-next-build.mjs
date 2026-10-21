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
    // Generated clients import each other via `.js` specifiers — the hook
    // must give webpack the `.js` → `.ts` mapping (real builds fail without)
    const alias = webpackConfig.resolve.extensionAlias?.['.js'];
    if (!alias || !alias.includes('.ts')) throw new Error('missing .js → .ts extensionAlias');
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

// Turbopack: no resolveAlias — absolute-path alias keys are inert in
// Turbopack (verified against Next 16), so the async variant must NOT set
// one. The compiled client still works there via export conditions.
const turboCfg = await withScriptcableAsync({ reactStrictMode: true }, { cwd: root });
if (turboCfg.turbopack?.resolveAlias) {
  throw new Error('turbopack.resolveAlias must not be set (absolute-path keys are inert): ' + JSON.stringify(turboCfg.turbopack));
}
if (!turboCfg.transpilePackages?.includes('@scriptcable/client')) throw new Error('missing transpilePackages');

console.log('next build wiring OK', gen);
