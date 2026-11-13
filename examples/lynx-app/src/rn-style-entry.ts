// Rspeedy (Rspack) recipe: Rspack's Rust resolver has no JS resolve-plugin
// hooks, so the entry drop-in redirect is a webpack-only mechanism. Here the
// compiled client arrives through `@unikit-bridge/scriptca-client` export conditions —
// the plugin still runs the build, emits artifacts, and links the package.
import { createClient } from '@unikit-bridge/scriptca-client';

const client = await createClient();
console.log(JSON.stringify({ sum: client.add(20, 22), hi: client.greet('lynx') }));
