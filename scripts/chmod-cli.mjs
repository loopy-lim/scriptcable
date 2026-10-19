import { chmodSync } from 'node:fs';
try { chmodSync(new URL('../packages/cli/dist/index.js', import.meta.url), 0o755); } catch {}
