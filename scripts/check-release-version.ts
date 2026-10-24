/**
 * check-release-version — 릴리스 태그(vX.Y.Z)와 모든 패키지 매니페스트 버전 일치 검사.
 * 13개 @scriptcable/* 패키지는 동기 버전 운용(가정 로그: docs/plans/2026-10-24-npm-publish-readiness.md).
 *
 * 사용법: bun scripts/check-release-version.ts v0.1.0  → 불일치 시 rc=1
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(tag)) {
  console.error(`사용법: bun scripts/check-release-version.ts v<version> — 받은 인수: ${tag ?? '(없음)'}`);
  process.exit(1);
}
const version = tag.replace(/^v/, '');
let ok = true;
for (const dir of readdirSync(join(ROOT, 'packages')).sort()) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'));
  const match = manifest.version === version;
  if (!match) ok = false;
  console.log(`${match ? 'ok       ' : 'MISMATCH '} ${manifest.name}@${manifest.version} (tag ${tag})`);
}
if (!ok) {
  console.error(`\n태그 ${tag}와 버전이 다른 패키지가 있습니다 — 모두 ${version}으로 맞춘 뒤 태그를 다시 푸시하세요.`);
  process.exit(1);
}
console.log(`\n모든 패키지가 ${version}으로 일치합니다.`);
