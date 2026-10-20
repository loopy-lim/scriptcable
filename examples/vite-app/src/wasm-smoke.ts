import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMinimalWasi } from '@scriptcable/core/wasi';
import { loadWasmModule } from '@scriptcable/core/wasm';
import type { ScriptcaProfile } from '@scriptcable/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const profile = JSON.parse(await readFile(join(root, '.scriptcable/profile.json'), 'utf8')) as ScriptcaProfile;
const bytes = await readFile(join(root, '.scriptcable/calculator.wasm'));
const mod = await loadWasmModule(bytes, { profile, wasi: createMinimalWasi() });
console.log(JSON.stringify({ sum: mod.call('add', 20, 22), hi: mod.call('greet', 'vite-wasm') }));
