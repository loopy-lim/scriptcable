/**
 * Whether bundler plugins may redirect imports of the core entry onto the
 * generated drop-in client. Only when the drop-in can provide the entry's
 * ENTIRE runtime export surface — a missing named export would break the
 * importing module, so any gap disables the redirection (correctness over
 * speed) with a printed reason.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ResolvedConfig, ScriptcableProfile } from '@scriptcable/types';
import { analyzeEntryExports } from './infer.js';

export type Interceptability = { ok: boolean; reasons: string[] };

export async function canInterceptEntry(
  config: ResolvedConfig,
  cwd: string,
  profile: ScriptcableProfile,
): Promise<Interceptability> {
  const entryAbs = resolve(cwd, config.entry);
  let source: string;
  try {
    source = await readFile(entryAbs, 'utf8');
  } catch {
    return { ok: false, reasons: [`entry ${config.entry} is not readable`] };
  }
  const surface = analyzeEntryExports(source, entryAbs);
  const reasons: string[] = [];
  for (const u of surface.unmapped.slice(0, 3)) reasons.push(`${u.name}: ${u.reason}`);
  if (surface.unmapped.length > 3) reasons.push(`…and ${surface.unmapped.length - 3} more`);
  // An explicit `exports` declaration may pin a subset — anything the source
  // exports but the profile lacks would be missing from the drop-in.
  const profileNames = new Set(profile.exports.map((e) => e.export));
  for (const name of surface.mapped) {
    if (!profileNames.has(name)) reasons.push(`${name}: not in the build profile (explicit exports subset?)`);
  }
  return { ok: reasons.length === 0, reasons };
}
