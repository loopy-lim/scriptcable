/**
 * Platform-aware PATH lookup. Windows: `where` — spawning the Unix `which`
 * there resolves to Git-Bash's, which returns MSYS paths (/c/Program
 * Files/...) that Node's spawn cannot execute.
 */
import { spawn } from 'node:child_process';

export async function which(cmd: string): Promise<string | undefined> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolvePromise) => {
    const child = spawn(probe, [cmd], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.on('close', (code) => {
      if (code !== 0 || !out.trim()) return resolvePromise(undefined);
      // `where` lists every match — the first line is PATH order
      resolvePromise(out.trim().split(/\r?\n/)[0]);
    });
  });
}
