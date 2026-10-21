/**
 * Drop-in E2E: a real vite dev server must rewrite an import of the core
 * entry (`../../calculator-core/src/core`) onto the generated drop-in
 * client. This is the observable "register the plugin → imports get fast"
 * contract, asserted without a browser:
 *
 *   - the transformed module references .scriptcable/generated/dropin/browser.ts
 *   - the TS source module no longer appears in the graph
 *
 * Run after `scriptcable build` (the plugin's buildStart also rebuilds —
 * this only asserts the resolver, so it works cold too).
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The dep scanner can race server.close() and reject after our assertions —
// scoped to this smoke process; assertions below own the exit code.
process.on('unhandledRejection', () => {});

const server = await createServer({
  root,
  configFile: join(root, 'vite.config.ts'),
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const transformed = await server.transformRequest('/src/dropin-app.ts');
  if (!transformed) throw new Error('transformRequest returned nothing for /src/dropin-app.ts');
  const code = transformed.code;
  if (!code.includes('dropin/browser.ts')) {
    throw new Error(
      `drop-in interception OFF — transformed module does not reference dropin/browser.ts\n---\n${code}\n---`,
    );
  }
  if (code.includes('calculator-core/src/core')) {
    throw new Error(`drop-in interception OFF — the TS entry is still in the graph\n---\n${code}\n---`);
  }
  console.log('drop-in smoke OK — entry import resolved to', code.match(/[^"']*dropin\/browser\.ts/)?.[0]);
} finally {
  try {
    await server.close();
  } catch {
    /* teardown races the dep scanner — outcome already asserted */
  }
}
