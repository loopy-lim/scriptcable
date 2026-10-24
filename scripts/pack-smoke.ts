#!/usr/bin/env bun
/**
 * pack-smoke — 발행 형태(tarball) 검증.
 *
 * 13개 @scriptcable/* 패키지를 `bun pm pack`으로 묶어 발행물과 동일한 형태를 검증한다:
 *   1. tarball manifest에 `workspace:` 프로토콜 잔존 없음(리라이트 확인)
 *   2. tarball에 files 필드 산출물(dist/LICENSE/README.md 등)이 실제로 들어있음
 *   3. 클린룸 프로젝트에 tarball만으로 설치해 핵심 패키지 임포트가 해석됨
 *   4. 설치된 cli bin이 `--help`로 응답
 *
 * 피어 의존 패키지(vite/webpack/next/expo)는 설치까지만 검증하고 임포트는 관찰 기록
 * (피어 부재 상태의 임포트 실패는 by-design일 수 있어 실패로 처리하지 않는다).
 *
 * 사용법: bun run build && bun scripts/pack-smoke.ts
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const PACKAGES_DIR = join(ROOT, 'packages');
const PACKAGE_DIRS = [
  'bun',
  'cli',
  'core',
  'expo',
  'lynx',
  'next',
  'node',
  'react-native',
  'tauri',
  'testing',
  'types',
  'vite',
  'webpack',
];
const PEER_PACKAGES = new Set(['vite', 'webpack', 'next', 'expo']);

const failures: string[] = [];
const notes: string[] = [];

function run(cmd: string[], opts: { cwd?: string } = {}) {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: opts.cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(
      `${cmd.join(' ')} failed (rc=${r.status})\nstdout: ${r.stdout?.slice(-800)}\nstderr: ${r.stderr?.slice(-800)}`,
    );
  }
  return r;
}

const work = mkdtempSync(join(tmpdir(), 'scriptcable-pack-smoke-'));
const packsDir = join(work, 'packs');
const projectDir = join(work, 'project');
mkdirSync(packsDir);
mkdirSync(projectDir);

try {
  // 1) pack — tarball이 이미 있으면 덮어쓴다.
  const tarballs: Record<string, string> = {}; // dir → tgz basename
  for (const dir of PACKAGE_DIRS) {
    const pkgJson = JSON.parse(readFileSync(join(PACKAGES_DIR, dir, 'package.json'), 'utf8'));
    if (!existsSync(join(PACKAGES_DIR, dir, 'dist')) && dir !== 'expo') {
      throw new Error(`${dir}: dist가 없습니다 — 먼저 \`bun run build\`를 실행하세요.`);
    }
    run(['bun', 'pm', 'pack', '--destination', packsDir, '--quiet'], {
      cwd: join(PACKAGES_DIR, dir),
    });
    const expected = `${pkgJson.name.replace('@', '').replace('/', '-')}-${pkgJson.version}.tgz`;
    const tgz = join(packsDir, expected);
    if (!existsSync(tgz)) throw new Error(`${dir}: 예상 tarball ${expected} 미생성`);
    tarballs[dir] = expected;
    console.log(`pack  ${pkgJson.name} → ${expected}`);
  }

  // 2) tarball manifest·내용물 검사
  const coreExports: string[] = [];
  const externalDeps = new Map<string, string>();
  for (const [dir, tgz] of Object.entries(tarballs)) {
    const tgzPath = join(packsDir, tgz);
    const manifestRaw = run(['tar', '-xOzf', tgzPath, 'package/package.json']).stdout;
    if (manifestRaw.includes('workspace:')) {
      failures.push(`${tgz}: workspace: 프로토콜 잔존`);
    }
    const manifest = JSON.parse(manifestRaw);
    if (manifest.publishConfig?.access !== 'public') {
      failures.push(`${tgz}: publishConfig.access=public 누락`);
    }
    const listing = run(['tar', '-tzf', tgzPath]).stdout;
    for (const required of manifest.files ?? []) {
      if (required === 'dist') {
        if (!/package\/dist\/index\.js(\n|$)/.test(listing)) {
          failures.push(`${tgz}: dist/index.js 없음`);
        }
      } else if (!listing.includes(`package/${required}`)) {
        failures.push(`${tgz}: files 산출물 package/${required} 없음`);
      }
    }
    if (dir === 'core') {
      coreExports.push(
        ...Object.keys(manifest.exports ?? {})
          .filter((k) => k !== '.')
          .map((k) => `@scriptcable/core/${k.replace('./', '')}`),
      );
    }
    // 외부(비 @scriptcable) 의존 수집 — 실제 소비자가 받을 범위 그대로 설치하기 위함
    for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
      if (!dep.startsWith('@scriptcable/')) externalDeps.set(dep, range as string);
    }
  }
  console.log(`check workspace:/files/access — ${PACKAGE_DIRS.length} tarball`);

  // 3) 클린룸 설치 — @scriptcable/*은 tarball만으로.
  // bun add는 tarball 간 상호 의존(@scriptcable/* — 레지스트리엔 아직 없음)을 registry에서
  // resolve하려 해 404로 실패한다(일괄·순차 모두). 발행 후에는 레지스트리가 해결하는 영역이므로:
  //   - 외부 의존(typescript, @babel/runtime, node-api-headers)과 의존 없는 types tarball은
  //     실제 소비자 경로(bun add)로 설치해 bun add tgz 경로 자체를 검증하고,
  //   - 나머지 형제 패키지는 tarball을 node_modules에 직접 전개한다(매니페스트 정합은 2)에서 검증됨).
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({ name: 'pack-smoke-room', private: true }, null, 2) + '\n',
  );
  run(
    [
      'bun',
      'add',
      ...[...externalDeps].map(([dep, range]) => `${dep}@${range}`),
    ],
    { cwd: projectDir },
  );
  run(['bun', 'add', join(packsDir, tarballs['types'])], { cwd: projectDir });
  console.log('install clean-room — 외부 의존 + types tarball (bun add 소비자 경로)');
  for (const dir of PACKAGE_DIRS) {
    const name = dir; // 스코프 단축명 == 디렉터리명
    const target = join(projectDir, 'node_modules', '@scriptcable', name);
    mkdirSync(target, { recursive: true });
    run(['tar', '-xzf', join(packsDir, tarballs[dir]), '-C', target, '--strip-components=1']);
  }
  console.log(`extract clean-room — ${PACKAGE_DIRS.length} tarball → node_modules/@scriptcable/*`);

  // 4) 임포트 해석 — 피어 비의존군은 단언, 피어군은 관찰
  const mustImport = [
    '@scriptcable/types',
    '@scriptcable/core',
    ...coreExports,
    '@scriptcable/node',
    '@scriptcable/bun',
    '@scriptcable/testing',
    '@scriptcable/react-native',
    '@scriptcable/tauri',
    '@scriptcable/lynx',
    '@scriptcable/cli',
    '@scriptcable/cli/codegen',
  ];
  const observe = PACKAGE_DIRS.filter((d) => PEER_PACKAGES.has(d)).map(
    (d) => readFileSync(join(PACKAGES_DIR, d, 'package.json'), 'utf8').match(/"name":\s*"([^"]+)"/)?.[1],
  );
  writeFileSync(
    join(projectDir, 'check.mjs'),
    `const must = ${JSON.stringify(mustImport, null, 2)};
const observe = ${JSON.stringify(observe, null, 2)};
let failed = 0;
for (const spec of must) {
  try { await import(spec); console.log('import ok  ' + spec); }
  catch (e) { failed++; console.error('import FAIL ' + spec + ' — ' + e.message); }
}
for (const spec of observe) {
  try { await import(spec); console.log('import ok  ' + spec + ' (peer-free)'); }
  catch (e) { console.log('import skip ' + spec + ' (peer missing — ' + e.message.split('\\n')[0] + ')'); }
}
process.exit(failed ? 1 : 0);
`,
  );
  const check = spawnSync('bun', ['check.mjs'], { cwd: projectDir, encoding: 'utf8' });
  console.log(check.stdout.trim());
  if (check.status !== 0) {
    failures.push(`임포트 단언 실패:\n${check.stdout}${check.stderr}`);
  }

  // 5) cli bin 스모크 — 설치된 tarball의 bin
  const binPath = join(projectDir, 'node_modules', '@scriptcable', 'cli', 'dist', 'index.js');
  const help = spawnSync('bun', [binPath, '--help'], { cwd: projectDir, encoding: 'utf8' });
  if (help.status !== 0 || !help.stdout.includes('Usage')) {
    failures.push(`cli bin --help 실패 (rc=${help.status})\n${help.stdout}${help.stderr}`);
  } else {
    console.log('cli bin --help ok');
  }
} finally {
  // 클린룸 node_modules는 용량이 커서 즉시 정리(로그는 표준출력으로 남김).
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\npack-smoke FAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\npack-smoke PASS — ${PACKAGE_DIRS.length} packages, clean-room install + import ok`);
if (notes.length > 0) for (const n of notes) console.log(`note: ${n}`);
