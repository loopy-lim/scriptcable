import { ScriptcaError } from '@scriptcable/types';

/** Format a scriptcable error for terminal output with its hint. */
export function formatError(e: unknown): string {
  if (e instanceof ScriptcaError) {
    const lines = [`✗ ${e.name} [${e.code}]: ${e.message}`];
    if (e.hint) lines.push(`  hint: ${e.hint}`);
    return lines.join('\n');
  }
  if (e instanceof Error) {
    return `✗ ${e.name}: ${e.message}`;
  }
  return `✗ ${String(e)}`;
}
