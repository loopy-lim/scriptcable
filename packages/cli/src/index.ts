#!/usr/bin/env node
import { runDoctor } from './commands/doctor.js';
import { runBuild } from './commands/build.js';
import { runDiff } from './commands/diff.js';
import { runInit } from './commands/init.js';
import type { CodegenTarget } from './codegen/index.js';

function usage(): void {
  console.log(`scriptca — TypeScript core → type-safe clients (via scriptc)

Usage:
  scriptca init <name>              scaffold a new project
  scriptca build [--target wasm|native|both] [--hosts node,bun,browser,...]
  scriptca diff [--snapshot path]   compare scriptca.json to committed contract
  scriptca doctor                   check Node / scriptc / zig / clang
  scriptca --help

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
      const name = rest[0];
      if (!name) {
        console.error('Usage: scriptca init <name>');
        return 1;
      }
      return runInit({ name });
    }
    case 'build': {
      let target: 'wasm' | 'native' | 'both' | undefined;
      let hosts: CodegenTarget[] | undefined;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--target') target = rest[++i] as typeof target;
        if (rest[i] === '--hosts') {
          hosts = rest[++i]!.split(',') as CodegenTarget[];
        }
      }
      return runBuild({ target, hosts });
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
