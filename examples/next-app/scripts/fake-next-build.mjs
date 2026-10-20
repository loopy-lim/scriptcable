import { withScriptcable, scriptcableBuild } from '@scriptcable/next';
import { access } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { sharedLibraryFileName } from '@scriptcable/core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gen = await scriptcableBuild({ cwd: root });
await access(join(root, '.scriptcable', sharedLibraryFileName('calculator')));

const cfg = withScriptcable({ reactStrictMode: true });
if (typeof cfg.webpack !== 'function') throw new Error('missing webpack hook');

await new Promise((resolve, reject) => {
  const webpackConfig = { plugins: [] };
  cfg.webpack(webpackConfig, {});
  const plugin = webpackConfig.plugins[0];
  plugin.apply({
    context: root,
    hooks: {
      beforeCompile: {
        tapPromise(_name, fn) {
          fn().then(resolve).catch(reject);
        },
      },
    },
  });
});

console.log('next build wiring OK', gen);
