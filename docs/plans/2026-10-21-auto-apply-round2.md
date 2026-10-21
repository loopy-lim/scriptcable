# 자동 적용 2차 — 브라우저 WASM · watch · CI 내구성 계획

- 날짜: 2026-10-21
- 기준 리비전: main @ 7f84a9d (작업 트리 clean)
- 원 요청: "현재 이 어플리케이션에서 더 발전할것이 무엇인지 찾아보자" → 후보 조사 후 "알아서 다 보고 진행해줘". 자동 적용([[auto-apply-dx-north-star]] — 앱 코드는 내부를 몰라야 한다)의 잔여 수동 단계 제거가 축.

## 목표와 범위

**사용자에게 달라지는 결과**

1. **F-1 브라우저 WASM 자동 적용**: Next 클라이언트 그래프에서 `createClient()`가 인자 없이 동작한다. next/webpack 플러그인이 빌드 시 `<name>.wasm`을 `public/`에 자동 복사하고, 생성된 browser 클라이언트가 URL 후보(모듈 상대 → 오리진 루트)를 HEAD 프로브로 자동 선택한다. README의 "copy `<name>.wasm` to your static directory" 수동 단계와 vite 예제의 `sync-public.mjs` 수동 스크립트가 사라진다. vite `build`(dist)에서도 브라우저 wasm이 동작한다(기존에는 모듈 상대 URL만 있어 dist에서 404).
2. **F-2 `scriptcable build --watch`**: Vite 외 호스트(Next Turbopack predev, Bun/Node 앱)에서 core.ts 수정이 자동 재빌드된다. 빌드 캐시 해시와 동일한 입력 세트(엔트리 + 같은 디렉터리 형제 .ts + 설정 파일)의 mtime을 폴링해 변경 시 빌드+코드젠을 재실행한다.
3. **F-3 CI 내구성 자동화(init)**: `scriptcable init`이 `.scriptcable/generated/`에 `@scriptcable/client` 플레이스홀더 매니페스트를 미리 쓰고, package.json에 `"@scriptcable/client": "file:.scriptcable/generated"`를 기록하며, 프로젝트 .gitignore에 플레이스홀더 2파일의 부정 패턴을 넣는다 → fresh clone에서 `bun install`이 실패하지 않고 링크가 유지된다. doctor는 dep 누락 시 정확한 스니펫을 안내한다(기존 프로젝트 package.json 자동 수정은 fresh-clone 설치 실패 함정 때문에 하지 않음).
4. **F-4 webpack 플러그인 테스트**: vite/next에는 플러그인 테스트가 있지만 webpack에는 없다 — 동일 패턴으로 추가.

**제외 범위**

- npm 퍼블리시 파이프라인(사용자 인증·외부 배포 결정 필요)
- i64/u64/bigint 마샬링(scriptc TS 레벨 노출 대기), callbacks 코어
- Windows CI/zig cc 폴링(별도 과제), 성능 회귀 게이트
- doctor의 package.json 자동 기록(위 F-3 근거), build 캐시의 임포트 그래프 추적(기존 한계 유지)

**현재 구조와 근거 (조사 완료)**

| 위치 | 현재 동작 |
|---|---|
| `packages/core/src/codegen.ts:251` | browser 클라이언트 `DEFAULT_URL = new URL(wasmRel, import.meta.url)` 단일 후보 — Next 클라이언트 그래프(청크 URL로 rewrite)·vite build(assets 하위)에서 404 |
| `packages/next/src/index.ts:26` | `buildCore(target:'native')` 하드코딩 — wasm 산출물 없음, README가 수동 public/ 복사 요구 |
| `examples/vite-app/scripts/sync-public.mjs` | 수동 public/.scriptcable/ 동기화 스크립트(빌드 스크립트에 `&&`로 결합) |
| `packages/vite/src/index.ts:38` | target 'both'로 wasm 생성하지만 public 복사 없음 — vite build 브라우저 404 |
| `packages/core/src/build-cache.ts:46-82` | `collectSourceHashes` — 엔트리+같은 디렉터리 형제 .ts 해시. watch가 이 입력 세트를 그대로 폴링하면 캐시와 일치 |
| `packages/core/src/config-loader.ts:50,74` | `?t=${Date.now()}` 캐시 버스트 import — watch 루프에서 설정 재해석 가능 |
| `bun install` 실증 (2026-10-21) | `file:` 대상 디렉터리에 package.json이 없으면 **설치 실패**("Could not find package.json") — dep 자동 기록은 플레이스홀더가 전제 |
| `.gitignore` (루트) | `.scriptcable/` 전체 무시 — 플레이스홀더 커밋엔 부정 패턴 필요 |
| `packages/cli/src/commands/init.ts:196-199` | `--from` 오버라이드 루프가 `@scriptcable/client`를 체크아웃 packages에서 찾아 실패할 것 → client는 건너뛰도록 수정 필요 |
| `packages/webpack/src/index.ts` | 플러그인 클래스, beforeCompile 훅 — 테스트 부재 |

**환경·도구**: Bun 1.4.x, bun:test, scriptc 0.3.6 + clang + zig 0.13 로컬 검증됨. 폴링 watch는 의존성 추가 없이 mtime stat으로 구현.

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | 생성 browser 클라이언트에 (a) 모듈 상대, (b) 오리진 루트 후보와 HEAD 프로브, (c) 명시적 `wasmUrl` 우선이 존재한다. 어느 후보도 HEAD로 확인 안 되면 첫 후보로 기존 동작(오류 노출) 유지 | T-1 | V-1 |
| AC-2 | next 플러그인 빌드 후 `public/<name>.wasm`이 존재하고, wasm이 없으면 자동으로 wasm 타깃을 빌드한다(zig 부재 등 실패 시 경고 1줄 + 네이티브만으로 계속). webpack 플러그인도 동일 | T-2 | V-2 |
| AC-3 | vite 플러그인이 `publicDir`(기본 `<root>/public`)에 wasm을 복사한다 — vite build 산출물 dist에서 브라우저가 `/<name>.wasm`으로 로드 가능 | T-3 | V-3 |
| AC-4 | `scriptcable build --watch`가 초기 빌드 후 core.ts 변경을 감지해 재빌드하고, 빌드 오류 시에도 감시를 유지한다. Ctrl+C로 종료 | T-4, T-5 | V-4 |
| AC-5 | `init` 산출 프로젝트에서 (a) package.json에 client file: dep, (b) 플레이스홀더 매니페스트, (c) .gitignore 부정 패턴이 있고, `bun install`이 fresh 상태에서 성공하며 `@scriptcable/client`가 해석된다 | T-6 | V-5 |
| AC-6 | doctor가 client dep 누락 시 스니펫을 안내한다 (기존 검사 회귀 없음) | T-7 | V-6 |
| AC-7 | 전체 회귀(test/typecheck/build + vite·next 예제) 통과, README/README.ko/CHANGELOG 갱신 | T-8, T-9 | V-7 |

## 설계

**F-1 (codegen + core 헬퍼)**

- `genBrowserClient`: `RELATIVE_URL`(import.meta.url 기준) + `rootUrl()`(document.baseURI / location.href 기준 `/{name}.wasm`, DOM·location 없으면 null) 후보 배열. `resolveWasmUrl(explicit)`: explicit 우선 → HEAD `{ok}` 프로브로 첫 도달 후보 → 모두 실패 시 `CANDIDATES[0]`(기존 동작 — 컴파일 오류가 그대로 노출). 모듈 스코프에 해석 결과 캐시(재호출 프로브 생략). Lynx/Tauri 클라이언트는 browser 템플릿 재사용이므로 자동 수혜.
- `client-package.ts`에 `copyWasmToPublicDir({publicDir, wasmPath, wasmName?}) → 'written'|'unchanged'|'skipped'` — skip-identical(기존 `copyIfChanged`와 같은 규약), 실패는 치명 아님.
- `toolchain.ts`에 `ensureWasmArtifact(config, {cwd, outDir?}) → string|undefined` — 기존 `.scriptcable/<name>.wasm` 재사용 → 없으면 `buildCore(target:'wasm')`(캐시 적용) → 실패 시 경고 1~2줄 + undefined. 네이티브 빌드를 절대 망가뜨리지 않는 소프트 보조.

**F-2 (CLI watch)**

- `build.ts`: 기존 본문을 `runBuildOnce`로 추출(산출물·client 로그 포함), `runBuild`는 `opts.watch`로 분기. `runWatch`: 초기 빌드 → 400ms 폴링 루프. 틱: 설정 파일 2종 mtime 확인(변경 시 설정 재해석) → 엔트리 디렉터리 .ts mtime 스캔(캐시의 same-dir 세트와 동일) → 변했으면 `resolveProfile`+`computeBuildHash`로 확정 → buildCore+writeGeneratedClients 재실행(실제 재빌드 로그 + `rebuilt in Nms`). 빌드 중 변경은 coalesce, 오류는 로그 후 감시 유지. SIGINT → exit 0.
- `index.ts`: `--watch` 파싱 + usage 문구.

**F-3 (init/doctor)**

- init: (1) `<root>/.scriptcable/generated/package.json` 플레이스홀더(`.` → `./placeholder.ts`, `@scriptcable/client` 이름 유지 — 첫 빌드의 `writeClientPackage`가 내용이 달라지면 덮어씀) + `placeholder.ts`(실행 시 "scriptcable build를 먼저 돌리라"는 오류), (2) deps에 `@scriptcable/client: file:.scriptcable/generated`(`--from` 오버라이드 루프는 client를 건너뛰게 수정), (3) `.gitignore` — `.scriptcable/*` + `!.scriptcable/generated/` + 내용 무시 + 플레이스홀더 2파일 재포함.
- doctor: 링크가 살아있고 package.json에 dep가 없으면 스니펫 2줄 안내(자동 기록 아님 — dep만 있고 플레이스홀더가 커밋 안 된 fresh clone은 bun install이 실패하므로, 기존 프로젝트에 대한 무분별한 자동 기록은 위험).

**오류·경계**

- HEAD 프로브: 네트워크 오류·405 등은 후보 스킵, 전부 실패 시 첫 후보(하위호환).
- `copyWasmToPublicDir` 실패(권한 등) → 'skipped' 반환, 플러그인은 조용히 계속(명시적 wasmUrl로 대체 가능).
- watch 폴링 중 편집 중인 파일 파싱 실패 → 오류 1줄, 마지막 해시 유지(수정 완료 시 재빌드).
- init 플레이스홀더: 첫 빌드가 매니페스트를 실제 플레이버로 교체 — 링크 대상 디렉터리가 동일해 symlink 재생성 불필요.

**호환성·롤백**

- browser 클라이언트 코드는 생성물 내용이 바뀌지만 시그니처(`createClient(options?)`) 불변. 명시적 `wasmUrl` 사용자 영향 없음.
- next/webpack 플러그인: 네이티브 빌드 경로 불변, wasm은 소프트 보조 → zig 없는 환경도 기존과 동일(경고 1줄 추가).
- 각 기능은 독립 커밋 단위로 롤백 가능. 스키마/계약 포맷 불변.

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 ID | 상태 |
|---|---|---|---|---|---|
| T-1 | browser 클라이언트 URL 후보+프로브 (AC-1) + codegen 테스트 | `packages/core/src/codegen.ts`, 신규 `packages/core/src/codegen.test.ts` | 없음 | V-1 | done |
| T-2 | `copyWasmToPublicDir` + `ensureWasmArtifact` + next/webpack 플러그인 적용 (AC-2) | `packages/core/src/{client-package,toolchain}.ts`, `packages/next/src/index.ts`, `packages/webpack/src/index.ts` | 없음 | V-2 | done |
| T-3 | vite 플러그인 public 복사 (AC-3) + 플러그인 테스트 갱신 | `packages/vite/src/index.ts`, `packages/vite/src/plugin.test.ts` | T-2 | V-3 | done |
| T-4 | CLI watch 루프 + `--watch` 플래그 (AC-4) | `packages/cli/src/commands/build.ts`, `packages/cli/src/index.ts` | 없음 | V-4 | done |
| T-5 | watch 통합 테스트 (AC-4) | 신규 `packages/cli/src/watch.integration.test.ts` | T-4 | V-4 | done |
| T-6 | init 플레이스홀더+dep+gitignore + `--from` 루프 수정 (AC-5) | `packages/cli/src/commands/init.ts` | 없음 | V-5 | done |
| T-7 | doctor dep 안내 + init 통합 테스트 (AC-5,6) | `packages/cli/src/commands/doctor.ts`, 신규 `packages/cli/src/init.integration.test.ts` | T-6 | V-5, V-6 | done |
| T-8 | webpack 플러그인 테스트 (F-4) + CI 포함 | 신규 `packages/webpack/src/plugin.test.ts`, `packages/webpack/package.json`(test 스크립트 신설), `.github/workflows/ci.yml` | T-2 | V-7 | done |
| T-9 | 예제 정리(sync-public 제거) + 문서(README.md/ko, CHANGELOG) (AC-7) | `examples/vite-app`, `README.md`, `README.ko.md`, `CHANGELOG.md` | T-1~T-8 | V-7 | done |

통합: V-7은 전 태스크 병합 후 수행 (개별 PASS ≠ 통합 PASS).

## 검증 계획과 결과

| ID | 방법·정의 근거 | cwd·환경 | 기대 결과 | 실제 결과·증거 | 판정 |
|---|---|---|---|---|---|
| V-1 | `bun test packages/core` — 생성 browser 클라이언트 문자열 검사(후보 2종·HEAD 프로브·explicit 우선·폴백·Lynx/Tauri 상속) | repo root | 신규 케이스 전부 pass | codegen.test.ts 5 pass + client-package.test.ts copyWasmToPublicDir 2 pass 포함 core 45 pass / 0 fail | PASS |
| V-2 | `bun test packages/next packages/webpack` + next-app 예제 빌드 | repo root (scriptc 0.3.6 + clang + zig) | 플러그인 빌드 후 public/에 wasm | next 1 pass(public 복사 단언 포함), webpack 1 pass(public 복사 단언), next-app test PASS — examples/next-app/public/calculator.wasm 생성 확인 | PASS |
| V-3 | `bun test packages/vite` + vite-app `bun run test`(ssr+wasm+vite build) | repo root | plugin 테스트 pass + dist 루트에 wasm | vite 2 pass, vite-app test PASS — public/calculator.wasm·dist/calculator.wasm 생성, dist/assets에는 wasm 없음(모듈 상대 후보 404 → 루트 후보가 담당하는 레이아웃 확인) | PASS |
| V-4 | `bun test packages/cli` — watch 통합 테스트 2케이스 | repo root | 초기 빌드→수정 재빌드, broken 코어 후 감시 유지·복구 | watch.integration.test.ts 2 pass (수정 재빌드 + broken 후 /still watching/ 마커·복구 재빌드) | PASS |
| V-5 | init 통합 테스트: `runInit(--from)` → dep·플레이스홀더·gitignore 검사 + `bun install` 성공 + placeholder 해석 | repo root | 설치 성공, createClient 해석 | init.integration.test.ts 1 pass — bun install 성공, placeholder createClient 해석(function). macOS /var→/private/var 심맹크는 realpath로 정규화 | PASS |
| V-6 | doctor가 dep 누락을 안내하는지 실호출 | examples/dx-app (생성물·링크 존재) | 안내 스니펫 출력, exit 0 | `client-dep: not CI-durable — add to package.json …(init scaffolds this)` 2줄 출력, 기존 검사줄 회귀 없음, exit 0 | PASS |
| V-7 | `bun run test && bun run typecheck && bun run build` 전체 + 예제 회귀 | repo root | 전부 성공 | test 총 57 pass / 0 fail(core 45·cli 4·vite 2·webpack 1·next 1·rn/tauri/lynx/node 각 1), typecheck 0 오류, build 성공, dx-app cache HIT, bench-core 빌드 성공 | PASS |

## 평가와 인계

- 구현 순서: T-1→T-2→(T-3,T-4,T-6)→(T-5,T-7,T-8)→T-9. 각 태스크 후 즉시 해당 패키지 테스트.
- F-1의 HEAD 프로브는 dev 서버(로컬) 기준 밀리초 미만 — 프로덕션 CDN에서 최초 1회 HEAD 2건 추가 가능, 모듈 스코프 캐시로 재호출 비용 0.
- 잔여 한계: (1) watch 폴링은 캐시와 동일한 same-dir 입력 세트만 감시(하위 디렉터리 임포트는 기존 캐시 한계와 동일) — fs.watch 재귀는 캐시 미추적 변경까지 유발해 오히려 혼란을 주므로 채택하지 않음; (2) doctor의 dep 안내는 수동 스니펫(자동 기록은 init 경로만); (3) 실기기 RN/Tauri 브라우저 플레이버 검증은 환경 부재로 기존과 동일.
- 후속 후보: npm 퍼블리시 파이프라인, contract gate GitHub Action, Windows CI, build 캐시 임포트 그래프 추적(watch 정확도도 함께 향상).
