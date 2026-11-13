#!/usr/bin/env bun
/**
 * assemble — 단일 발행 패키지(@unikit-bridge/scriptcable) 조립.
 *
 * 13개 내부 workspace 패키지(@scriptcable/*, private)의 dist를 모아
 * `dist/<pkg>/` 트리로 복사하고, import specifier를 발행 이름으로 rewrite한다:
 *
 *   1. `@scriptcable/client` → `@unikit-bridge/scriptcable-client`
 *      (사용자 프로젝트에 생성되는 로컬 placeholder 패키지명)
 *   2. `@scriptcable/…`     → `@unikit-bridge/scriptcable/…`
 *      (내부 workspace import → self-referencing subpath)
 *
 * 그리고 이 package.json의 `exports` 맵이 형제 패키지들의 exports에서
 * 파생된 것과 정확히 일치하는지 검사한다(drift 게이트 — 형제가 subpath를
 * 추가하면 여기도 갱신해야 빌드가 통과한다).
 *
 * dist에 `@scriptcable` 문자열이 하나라도 남으면 빌드는 실패한다.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG_ROOT = import.meta.dir + '/..';
const ROOT = join(PKG_ROOT, '..', '..');
const DIST = join(PKG_ROOT, 'dist');
const NAME = '@unikit-bridge/scriptcable';
const CLIENT_NAME = '@unikit-bridge/scriptcable-client';

const PKGS = [
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
] as const;

type Cond = Record<string, string>;

/** 형제 패키지 exports를 단일 패키지의 subpath exports로 변환한다. */
function deriveExports(): Record<string, Cond> {
  const out: Record<string, Cond> = {};
  for (const pkg of PKGS) {
    const sibling = JSON.parse(readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8'));
    let exports = (sibling.exports ?? {}) as Record<string, Cond> | null;
    if ((!exports || Object.keys(exports).length === 0) && Array.isArray(sibling.files)) {
      // dist 없는 패키지(expo): files 산출물 중 진입점을 subpath로 노출한다.
      const entry = sibling.files.find((f: string) => f.endsWith('.js'));
      if (entry) exports = { '.': { import: `./dist/${entry.replace(/^\.\//, '')}` } } as Record<string, Cond>;
    }
    for (const [key, cond] of Object.entries(exports ?? {})) {
      const sub = key === '.' ? `./${pkg}` : `./${pkg}${key.replace(/^\./, '')}`;
      const mapped: Cond = {};
      for (const [condition, file] of Object.entries(cond)) {
        mapped[condition] = file.replace(/^\.\/dist\//, `./dist/${pkg}/`);
      }
      out[sub] = mapped;
    }
  }
  // 루트 진입점은 core로 통일한다.
  out['.'] = out['./core'];
  // 키 순서를 안정적으로(깊은 정렬) 만들어 커밋된 맵과 비교한다.
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** dist 안 모든 텍스트 파일에 rewrite를 적용한다. */
function rewriteTree(dir: string): number {
  let touched = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      touched += rewriteTree(p);
      continue;
    }
    if (!/\.(js|mjs|cjs|ts|d\.ts|json|map|txt)$/.test(entry)) continue;
    let text = readFileSync(p, 'utf8');
    if (!text.includes('@scriptcable')) continue;
    const next = text
      .replaceAll('@scriptcable/client', CLIENT_NAME)
      .replaceAll('@scriptcable/', `${NAME}/`);
    if (next !== text) {
      writeFileSync(p, next);
      touched++;
    }
  }
  return touched;
}

// ── 조립 ────────────────────────────────────────────────────────────────────

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

for (const pkg of PKGS) {
  const src = join(ROOT, 'packages', pkg, 'dist');
  if (existsSync(src)) {
    cpSync(src, join(DIST, pkg), { recursive: true });
    continue;
  }
  // dist가 없는 패키지(expo — 빌드 없는 단일 app.plugin.js): files 산출물을 직접 복사.
  const manifest = JSON.parse(readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8'));
  const shipped = (manifest.files ?? []).filter((f: string) => !/^(LICENSE|README)/.test(f) && f !== 'package.json');
  if (shipped.length === 0) {
    console.error(`[assemble] packages/${pkg}에 dist도 files 산출물도 없음`);
    process.exit(1);
  }
  mkdirSync(join(DIST, pkg), { recursive: true });
  for (const f of shipped) cpSync(join(ROOT, 'packages', pkg, f), join(DIST, pkg, f));
}

const touched = rewriteTree(DIST);

// 잔존 게이트 — 발행물에 @scriptcable이 남으면 안 된다.
let residual = 0;
const walk = (dir: string) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs|cjs|ts|d\.ts|json|map|txt)$/.test(entry) && readFileSync(p, 'utf8').includes('@scriptcable')) {
      console.error(`[assemble] @scriptcable 잔존: ${p}`);
      residual++;
    }
  }
};
walk(DIST);
if (residual > 0) {
  console.error(`[assemble] ${residual}개 파일에 @scriptcable 잔존 — rewrite 규칙 확인 필요`);
  process.exit(1);
}

// exports drift 게이트 — 커밋된 exports가 파생 결과와 다르면 빌드 실패.
// (키 순서는 무시한다 — canonicalize 후 비교)
const canonical = (o: Record<string, Cond>) =>
  JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))));
const own = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
const derived = deriveExports();
const committed = canonical(own.exports) === canonical(derived);
if (!committed) {
  console.error('[assemble] exports 맵이 형제 패키지와 불일치 — packages/scriptcable/package.json의 exports를 갱신할 것');
  console.error('파생된 맵:');
  console.error(JSON.stringify(derived, null, 2));
  process.exit(1);
}

console.log(`[assemble] ${PKGS.length}개 패키지 조립 완료 — ${touched}개 파일 rewrite, exports 일치, 잔존 0건`);
