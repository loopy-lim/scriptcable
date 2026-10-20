# Zero-config DX 개선 계획

- 날짜: 2026-10-20
- 기준 리비전: main @ 0410642 (작업 트리 clean)
- 원 요청: "zeroconfig에 가까운 DX 경험을 넣어야 하지 않을까? 개선을 진행해 달라"

## 목표와 범위

**사용자에게 달라지는 결과**

1. 설정 파일(`scriptcable.config.ts` / `scriptcable.json`)이 **없어도** `scriptcable build`가 동작한다 — `name`은 `package.json`에서, `entry`는 표준 후보 위치에서 추론한다.
2. 설정 파일이 있어도 `name`/`entry`를 생략할 수 있다 (파일에 명시한 값이 추론값보다 우선).
3. vite/next/webpack 플러그인이 `scriptcable.config.ts`(init이 생성하는 기본 포맷)를 읽는다. 현재는 JSON만 파싱해 문서·init 플로우와 불일치.
4. `createNodeEngine()` / `createBunEngine()`이 `outDir` 없이 `.scriptcable` 기본값으로 동작한다.
5. README/README.ko에 zero-config 사용법을 문서화한다.

**제외 범위**

- `init` 스캐폴드 변경 없음 (명시적 config 생성 유지 — 학습용 산출물로 가치 있음)
- `doctor`, `codegen`, Lynx/RN/Tauri 호스트 플로우 로직 변경 없음 (loadProjectConfig/resolveProfile 경유로 자동 수혜)
- 신규 패키지·신규 커맨드 추가 없음

**현재 구조와 근거 (조사 완료)**

| 위치 | 현재 동작 |
|---|---|
| `packages/core/src/config-loader.ts:32-58` | 설정 파일 없으면 throw |
| `packages/core/src/profile.ts:97-98` | `name`/`entry` 없으면 throw (`loadConfig`) |
| `packages/core/src/profile.ts:44-72` | `resolveProfile`은 exports만 추론 (name/entry는 이미 있다고 가정) |
| `packages/vite/src/index.ts:31`, `packages/next/src/index.ts:21`, `packages/webpack/src/index.ts:24` | `JSON.parse(readFile('scriptcable.json'))` — TS config 미지원, 설정 없으면 실패 |
| `packages/node/src/index.ts:29-35` | `outDir` 필수 |
| `packages/types/src/index.ts:60-64` | `name: string; entry: string` 필수 |
| `packages/core/src/profile.ts:84-90` | slug 유틸 존재 (재사용) |
| `packages/core/src/config-loader.test.ts` | node_modules symlink 패턴의 테스트 존재 (재사용) |

**환경·도구**: Bun 1.4.x, bun:test, `bun run test` / `typecheck` / `build` 스크립트 존재(root package.json). scriptc + clang 로컬 사용 가능(기존 예제 빌드로 검증됨). 위임 평가자: Agent 도구 사용 가능.

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | 설정 파일 없이 `scriptcable build` 성공: name은 package.json에서, entry는 후보(`src/core.ts` > `core.ts` > `src/index.ts` > `index.ts`) 첫 존재에서 추론. 추론 불가 시 검색한 후보를 나열하는 오류 | T-1, T-2 | V-1, V-2 |
| AC-2 | 설정 파일이 name/entry를 생략해도 빌드 성공. 파일 필드가 추론값보다 우선 | T-1 | V-1 |
| AC-3 | vite/next/webpack 플러그인이 `scriptcable.config.ts`를 읽고, 설정 파일이 없어도 동작. `scriptcable.json` 기존 동작 유지 | T-3 | V-3 |
| AC-4 | `createNodeEngine()`이 outDir 없이 `.scriptcable`을 기본 사용 | T-4 | V-4 |
| AC-5 | 기존 완전한 설정 프로젝트(name/entry/exports 명시) 회귀 없음 | T-1~T-4 | V-5 |
| AC-6 | README.md·README.ko.md에 zero-config 사용법 문서화 | T-5 | V-6 |

## 설계

**핵심 개념: `ResolvedConfig`**

- `@scriptcable/types`: `ScriptcableConfig.name`/`entry`를 optional로 변경. `ResolvedConfig = ScriptcableConfig & { name: string; entry: string }` 추가.
- `@scriptcable/core` 신규 모듈 `defaults.ts` (순환 import 방지 — config-loader와 profile이 양쪽에서 사용):
  - `inferProjectName(cwd)`: package.json `name` → 기존 `slug()` 적용 → 없으면 디렉터리 basename slug.
  - `findCoreEntry(cwd)`: 후보 `['src/core.ts','core.ts','src/index.ts','index.ts']` 중 첫 존재 파일. 없으면 null.
- `config-loader.ts`:
  - `loadConfig`: name/entry가 *제공된 경우에만* 문자열·비어있지 않음 검증. 없으면 통과(추론은 resolve 단계).
  - 신규 `resolveProjectConfig(cwd) → { config: ResolvedConfig; source: 'scriptcable.config.ts'|'scriptcable.json'|'inferred'; inferredFields: string[] }`.
  - `loadProjectConfig`은 resolveProjectConfig로 위임(반환 config가 ResolvedConfig가 되어 하위 호환). 파일이 아예 없고 entry도 못 찾으면: "No scriptcable config and no core entry found. Searched: … Create scriptcable.config.ts or one of these entries." (기존 테스트가 기대하는 `scriptcable.config.ts` 문구 포함).
  - `loadConfigFile(path)` 헬퍼: `.ts`면 TS 임포트, `.json`이면 JSON — CLI `--config`와 플러그인 `configPath` 옵션에서 재사용.
- `profile.ts`: `configToProfile(config: ResolvedConfig)`. `resolveProfile(config, cwd)`는 partial config를 받아 name/entry를 defaults.ts로 채운 뒤 기존 로직 수행 — build/diff/플러그인은 resolveProfile 하나만 신뢰.
- `toolchain.ts` `buildCore`: 파라미터 타입만 ResolvedConfig로 (런타임 변화 없음).
- CLI `build`/`diff`: `loadProjectConfig` 그대로 → 자동 수혜. `--config`에 `.ts` 지원 추가.
- 플러그인 3종: `JSON.parse(readFile('scriptcable.json'))` → `resolveProjectConfig(root)`. `options.configPath`가 명시되면 `loadConfigFile` 사용(기존 옵션 유지). vite `handleHotUpdate`는 두 설정 파일명과 엔트리 모두 감시.
- 어댑터(node, bun은 re-export): `NodeClientOptions.outDir?: string` — 기본 `'.scriptcable'` (process.cwd() 기준).

**오류·경계 처리**

- entry 후보 부재 + 설정 파일 부재 → 위의 나열형 오류.
- package.json 부재 → 디렉터리 basename을 slug로 사용.
- slug 결과 빈 문자열 → `'app'` (기존 slug 동작 유지).
- TS config에 default export 없음 → 기존 오류 유지.

**호환성·롤백**

- 기존 프로젝트(전 필드 명시)는 동일 경로로 동작 — 파일 필드가 항상 추론보다 우선.
- 변경은 git revert 한 단위로 롤백 가능. 스키마 파일(profile.json/contract.json) 포맷 불변.

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 ID | 상태 |
|---|---|---|---|---|---|
| T-1 | ResolvedConfig 타입 + defaults.ts + resolveProjectConfig + loadConfig 완화 + resolveProfile 확장 + core 단위 테스트 (AC-1,2) | `packages/types/src/index.ts`, `packages/core/src/{defaults,config-loader,profile}.ts`, `packages/core/src/config-loader.test.ts` | 없음 | V-1 | done |
| T-2 | CLI build/diff 추론 경로 + `--config` TS 지원 (AC-1) | `packages/cli/src/commands/{build,diff}.ts`, 통합 테스트 `packages/cli/src/build.integration.test.ts`, cli package.json test 스크립트 | T-1 | V-2 | done |
| T-3 | 플러그인 3종 resolveProjectConfig 전환 (AC-3) | `packages/vite/src/index.ts`, `packages/next/src/index.ts`, `packages/webpack/src/index.ts` | T-1 | V-3 | done |
| T-4 | node 어댑터 outDir 기본값 (AC-4) | `packages/node/src/index.ts` | 없음 | V-4 | done |
| T-5 | 문서 (AC-6) | `README.md`, `README.ko.md` | T-1~T-4 | V-6 | done |

통합: V-5는 전 태스크 병합 후 수행 (개별 PASS ≠ 통합 PASS).

## 검증 계획과 결과

| ID | 방법·정의 근거 | cwd·환경 | 기대 결과 | 실제 결과·증거 | 판정 |
|---|---|---|---|---|---|
| V-1 | `bun test packages/core` — 신규 케이스: 설정 없음+src/core.ts+package.json → inferred; name/entry 생략 설정 파일; 후보 없음 오류 메시지; 파일 필드 우선순위 | repo root | 전부 pass | bun test packages/core — 24 pass, 0 fail (zero-config 7케이스 포함) | PASS |
| V-2 | `bun test packages/cli` — 실제 scriptc 컴파일 동반 통합 테스트: tmp 프로젝트(설정 파일 없음, package.json+src/core.ts, node_modules symlink)에서 runBuild | repo root (scriptc 0.3.6, clang — 로컬 확인됨) | build 성공 + "inferred" 로그 + 산출물 존재 | build.integration.test.ts 1 pass — 설정 파일 없이 libzero_cfg_it.dylib + generated/node.ts 생성, 495ms | PASS |
| V-3 | 플러그인 소스가 resolveProjectConfig 경유인지 코드 대조 + core 테스트가 TS-config 로딩 커버 | repo root | JSON-only 파싱 제거 확인 | 대조 완료 — vite/next/webpack 모두 loadProjectConfig/loadConfigFile 사용, `JSON.parse(readFile)` 제거. 플러그인 자체 테스트 없음(기존과 동일) | PASS (한계: 플러그인 통합 테스트 부재 — 기존 상태와 동일) |
| V-4 | `bun run typecheck`에서 outDir 생략 호출 컴파일 확인 | repo root | 타입 에러 없음, 기본값 동작 | typecheck 전체 pass — NodeClientOptions.outDir?, createNodeEngineFromOutDir(outDir?) 시그니처 | PASS |
| V-5 | `bun run test && bun run typecheck && bun run build` + `bun run --filter @scriptcable/example-dx-app build` (기존 설정 회귀) | repo root | 전부 성공 | test 29 pass / 0 fail · typecheck pass · build pass · dx-app scriptcable build cache HIT 성공 | PASS |
| V-6 | 문서 대조 읽기 | — | zero-config 섹션 존재 + 실제 동작과 일치 | README.md "Zero-config" + README.ko.md "제로 설정" 섹션 추가, 추론 표가 구현(CORE_ENTRY_CANDIDATES, slugPackageName)과 일치 | PASS |

## 평가와 인계

- G1 계획: validate-plan plan 모드 self-review — PASS (AC↔T↔V 연결, 실제 명령 확인)
- G3 코드 리뷰: 독립 평가자 위임 — **PASS**. 작성자 검증 6종 전부 재실행 + 미기록 재현 4건 추가(vite/next 예제 빌드, TS-config 전용 플러그인 경로, outDir 기본 실호출, Node 22 TS import). 결함 4건 전부 P3:
  - F1 README 추론 예시 오류(`my_pkg`→`scope_my_pkg`) — 수정 완료 (README.md/README.ko.md)
  - F2 CI에 cli 테스트 미포함 — 수정 완료 (ci.yml에 core/cli/vite test 단계 추가)
  - F3 이중 설정 시 플러그인이 json→ts 우선순위 전환 — CHANGELOG에 명시로 수용
  - F4 vite HMR이 무관 이벤트마다 config 재해석 — 수정 완료(조기 종료 가드) + `packages/vite/src/plugin.test.ts` 회귀 테스트 추가(HMR: 무관 0회/entry 1회/config 1회)
- G5 완료: **PASS** — AC-1~6 전부 충족(아래 증거). F4 수정 후 영향 검증 재실행: `bun test packages/vite` 2 pass, `bun run --filter @scriptcable/example-vite-app build` 성공, 전체 test/typecheck/build 재통과.
- 잔여 한계: (1) Node < 22.18(타입 스트리핑 비기본)에서 TS config 동적 import 미동작 — Bun이 1차 런타임이므로 수용; (2) HMR 재검증은 plugin.test.ts 시뮬레이션 기준(실제 vite dev 서버 세션 아님).
- 후속 후보: `@scriptcable/client` 가상 모듈 별칭의 범용 확대(사용자 아이디어), F3 이중 설정 프로젝트 테스트.

### 최종 AC별 증거

| AC | 증거 |
|---|---|
| AC-1 | `bun test packages/cli` 통합 테스트 — 설정 파일 없이 libzero_cfg_it.dylib + generated/node.ts 생성, profile.name=zero_cfg_it(package.json 추론) |
| AC-2 | core 단위 테스트: name/entry 생략 설정 파일 해석, 파일 필드 우선순위 |
| AC-3 | vite plugin.test.ts — scriptcable.config.ts 단독 프로젝트 빌드 + HMR 게이팅; 독립 평가자의 next 예제 빌드 재현 |
| AC-4 | typecheck(outDir 생략) + 독립 평가자의 createBunEngine() 기본 로드·add(2,3)=5 실호출 |
| AC-5 | dx-app(전 필드 명시) 빌드 cache HIT 성공, 전체 test 31 pass/0 fail, typecheck/build 성공 |
| AC-6 | README.md "Zero-config" / README.ko.md "제로 설정" 섹션, 추론 표가 구현·테스트와 일치(F1 수정 반영) |
