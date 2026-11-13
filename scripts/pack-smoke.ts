#!/usr/bin/env bun
/**
 * pack-smoke — 발행 형태(tarball) 검증 (단일 패키지 @unikit-bridge/scriptcable).
 *
 * 1. `bun pm pack`으로 발행물과 동일한 tarball을 만든다
 * 2. manifest에 `workspace:` 잔존 없음 · publishConfig.access=public · files 산출물 실재
 * 3. tarball 내부에 구(@) `@scriptcable` 지정자 잔존 없음 (조립 rewrite 게이트)
 * 4. 클린룸 프로젝트에 tarball만으로 설치해 exports 맵의 모든 subpath import가 해석됨
 * 5. 설치된 cli bin이 `--help`로 응답
 *
 * 사용법: bun run build && bun scripts/pack-smoke.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PKG_DIR = join(import.meta.dir, '..', 'packages', 'scriptcable');
const NAME = '@unikit-bridge/scriptcable';

const failures: string[] = [];

function run(cmd: string[], opts: { cwd?: string } = {}) {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: opts.cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(
      `${cmd.join(' ')} failed (rc=${r.status})\nstdout: ${r.stdout?.slice(-800)}\nstderr: ${r.stderr?.slice(-800)}`,
    );
  }
  return r;
}

if (!existsSync(join(PKG_DIR, 'dist'))) {
  console.error('packages/scriptcable/dist 없음 — 먼저 `bun run build`를 실행하세요.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
const version = manifest.version as string;
const tgzName = 'unikit-bridge-scriptcable-' + version + '.tgz';

const work = mkdtempSync(join(tmpdir(), 'scriptcable-pack-smoke-'));

try {
  // 1) pack
  run(['bun', 'pm', 'pack', '--destination', work, '--quiet'], { cwd: PKG_DIR });
  const tgz = join(work, tgzName);
  if (!existsSync(tgz)) throw new Error(`예상 tarball ${tgzName} 미생성`);
  console.log(`pack  ${NAME} → ${tgzName}`);

  // 2) manifest 검사
  const manifestRaw = run(['tar', '-xOzf', tgz, 'package/package.json']).stdout;
  if (manifestRaw.includes('workspace:')) failures.push('manifest: workspace: 프로토콜 잔존');
  const packed = JSON.parse(manifestRaw);
  if (packed.publishConfig?.access !== 'public') failures.push('manifest: publishConfig.access=public 누락');
  for (const dep of Object.keys(packed.dependencies ?? {})) {
    if (dep.startsWith('@scriptcable')) failures.push(`manifest: 내부 의존 잔존 (${dep}) — 조립 rewrite 누락`);
  }
  const listing = run(['tar', '-tzf', tgz]).stdout;
  for (const required of packed.files ?? []) {
    if (required === 'dist') {
      if (!/package\/dist\/core\/index\.js(\n|$)/.test(listing)) failures.push('tarball: dist/core/index.js 없음');
    } else if (!listing.includes(`package/${required}`)) {
      failures.push(`tarball: files 산출물 package/${required} 없음`);
    }
  }
  // exports 맵이 가리키는 파일이 전부 tarball에 있다
  for (const cond of Object.values<any>(packed.exports ?? {})) {
    for (const file of Object.values<string>(cond)) {
      if (!listing.includes(`package/${file.replace(/^\.\//, '')}`)) {
        failures.push(`tarball: exports가 가리키는 ${file} 없음`);
      }
    }
  }
  console.log(`check manifest/files/exports — ${Object.keys(packed.exports ?? {}).length} subpath`);

  // 3) 잔존 지정자 게이트 — tarball 전체 파일에서 구 @scriptcable 지정자 0건
  const extracted = join(work, 'extracted');
  mkdirSync(extracted);
  run(['tar', '-xzf', tgz, '-C', extracted, '--strip-components=1']);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(js|mjs|cjs|ts|json|map)$/.test(entry)) continue;
      if (readFileSync(p, 'utf8').includes('@scriptcable')) {
        failures.push(`잔존 지정자 @scriptcable: ${entry}`);
      }
    }
  };
  walk(extracted);
  console.log('check legacy @scriptcable 지정자 — 0건이어야 함');

  // 4) 클린룸 설치 + subpath import
  const projectDir = join(work, 'project');
  mkdirSync(projectDir);
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({ name: 'pack-smoke-room', private: true }, null, 2) + '\n',
  );
  run(['bun', 'add', tgz], { cwd: projectDir });
  console.log('install clean-room — bun add tarball (소비자 경로)');

  const importOk: string[] = [];
  const importSkip: string[] = [];
  for (const sub of Object.keys(packed.exports ?? {})) {
    const spec = sub === '.' ? NAME : `${NAME}${sub.replace(/^\./, '')}`;
    // expo는 피어(expo)가 없으면 로드 불가 — 설치·해석 관찰로 기록
    if (sub === './expo') { importSkip.push(spec); continue; }
    const r = run(['bun', '-e', `import(${JSON.stringify(spec)})`], { cwd: projectDir });
    void r;
    importOk.push(spec);
  }
  console.log(`import ok  ${importOk.length} subpath` + (importSkip.length ? ` (skip: ${importSkip.join(', ')})` : ''));

  // 5) cli bin
  const help = run(['bun', join(projectDir, 'node_modules', '.bin', 'scriptcable'), '--help'], { cwd: projectDir });
  if (!/usage|scriptcable/i.test(help.stdout ?? '')) failures.push('cli bin --help 응답 이상');
  console.log('cli bin --help ok');
} catch (err) {
  failures.push(String(err));
}

if (failures.length > 0) {
  console.error('\npack-smoke FAIL:');
  for (const f of failures) console.error(`  - ${f}`);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}
console.log(`\npack-smoke PASS — ${NAME}@${version}, 클린룸 설치 + subpath import ok`);
rmSync(work, { recursive: true, force: true });
