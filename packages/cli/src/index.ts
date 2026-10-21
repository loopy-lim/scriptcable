#!/usr/bin/env bun
import { runDoctor } from './commands/doctor.js';
import { runBuild } from './commands/build.js';
import { runDiff } from './commands/diff.js';
import { runInit } from './commands/init.js';
import type { CodegenTarget } from './codegen/index.js';

function usage(): void {
  console.log(`scriptcable — TypeScript core → native clients (via scriptc; WASM opt-in)

Usage:
  scriptcable init <name> [--host bun|node|vite|next|tauri|react-native|lynx]
  scriptcable build [--target wasm|native|both] [--hosts bun,node,browser,...] [--force] [--watch]
  scriptcable diff [--snapshot path]   compare scriptcable.json to committed contract
  scriptcable doctor                   check Bun / scriptc / zig / clang
  scriptcable --help

Docs: see the repo README. scriptc: https://scriptc.dev
`);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h') {
    usage();
    return 0;
  }
  switch (cmd) {
    case 'doctor':
      return runDoctor();
    case 'init': {
      const name = rest.find((a) => !a.startsWith('-'));
      if (!name) {
        console.error('Usage: scriptcable init <name> [--host bun|node|vite|next|tauri|react-native|lynx]');
        return 1;
      }
      let host: import('./commands/init.js').InitHost | undefined;
      let from: string | undefined;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--host') host = rest[++i] as typeof host;
        if (rest[i] === '--from') from = rest[++i];
      }
      if (host === undefined) host = 'bun';
      return runInit({ name, host, from });
    }
    case 'build': {
      let target: 'wasm' | 'native' | 'both' | undefined;
      let hosts: CodegenTarget[] | undefined;
      let force = false;
      let watch = false;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--target') target = rest[++i] as typeof target;
        if (rest[i] === '--hosts') {
          hosts = rest[++i]!.split(',') as CodegenTarget[];
        }
        if (rest[i] === '--force') force = true;
        if (rest[i] === '--watch') watch = true;
      }
      return runBuild({ target, hosts, force, watch });
    }
    case 'diff': {
      let snapshot: string | undefined;
      let failOnBreaking = true;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--snapshot') snapshot = rest[++i];
        if (rest[i] === '--fail-on-breaking') failOnBreaking = true;
        if (rest[i] === '--no-fail') failOnBreaking = false;
      }
      return runDiff({ snapshot, failOnBreaking });
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
      return 1;
  }
}

const code = await main(process.argv.slice(2));
process.exit(code);
