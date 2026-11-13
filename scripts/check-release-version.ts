/**
 * check-release-version — 릴리스 태그(vX.Y.Z)와 발행 패키지 매니페스트 버전 일치 검사.
 *
 * 발행물은 단일 패키지 @unikit-bridge/scriptcable (packages/scriptcable)뿐 —
 * 나머지 13개 workspace 패키지는 private(개발 전용)이라 버전 동기 대상이 아니다.
 *
 * 사용법: bun scripts/check-release-version.ts v0.1.0  → 불일치 시 rc=1
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(tag)) {
  console.error(`사용법: bun scripts/check-release-version.ts v<version> — 받은 인수: ${tag ?? '(없음)'}`);
  process.exit(1);
}
const version = tag.replace(/^v/, '');
const manifest = JSON.parse(readFileSync(join(ROOT, 'packages', 'scriptcable', 'package.json'), 'utf8'));
const ok = manifest.version === version;
console.log(`${ok ? 'ok       ' : 'MISMATCH '} ${manifest.name}@${manifest.version} (tag ${tag})`);
if (!ok) {
  console.error(`\n태그 ${tag}와 packages/scriptcable 버전(${manifest.version})이 다릅니다 — 맞춘 뒤 태그를 다시 푸시하세요.`);
  process.exit(1);
}
console.log(`\n${manifest.name}이(가) ${version}과(와) 일치합니다.`);
