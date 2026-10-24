#!/usr/bin/env bun
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runDoctor } from './commands/doctor.js';
import { runBuild } from './commands/build.js';
import { runDiff } from './commands/diff.js';
import { runInit } from './commands/init.js';
import type { CodegenTarget } from './codegen/index.js';

function usage(): void {
  console.log(`scriptcable — TypeScript core → native clients (via scriptc; WASM opt-in)

Usage:
  scriptcable init <name> [--host bun|node|vite|next|tauri|react-native|lynx]
  scriptcable build [--target wasm|native|both] [--hosts bun,node,browser,...] [--platform host|android] [--force] [--watch]
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
      let platform: 'host' | 'android-arm64' | undefined;
      let force = false;
      let watch = false;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--target') target = rest[++i] as typeof target;
        if (rest[i] === '--hosts') {
          hosts = rest[++i]!.split(',') as CodegenTarget[];
        }
        if (rest[i] === '--platform') {
          const v = rest[++i]!;
          platform = v === 'android' ? 'android-arm64' : v === 'host' ? 'host' : undefined;
          if (platform === undefined) {
            console.error(`Unknown --platform "${v}" (supported: host, android)`);
            return 1;
          }
        }
        if (rest[i] === '--force') force = true;
        if (rest[i] === '--watch') watch = true;
      }
      return runBuild({ target, hosts, platform, force, watch });
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

// bin 실행에서만 main을 돌린다 — 라이브러리 임포트(@scriptcable/cli)가
// CLI를 실행·process.exit하는 일이 없어야 발행 후 import가 안전하다.
// import.meta.main은 Bun 전용이라 Node 직접 실행(`node dist/index.js`)을 위해
// entry URL 대조를 함께 본다(G3 리뷰 F-1 — Node에선 침묵 no-op이 되지 않게).
const invokedAsMain =
  import.meta.main ||
  (typeof process !== 'undefined' &&
    !!process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href);
if (invokedAsMain) {
  if (typeof Bun === 'undefined') {
    console.error('scriptcable CLI runs on Bun — install Bun >= 1.2 (https://bun.sh).');
    process.exit(1);
  }
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
