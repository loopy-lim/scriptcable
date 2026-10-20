# 클라이언트 import 자동 적용 계획 (`@scriptcable/client` 보편화)

- 날짜: 2026-10-20
- 기준 리비전: main @ 0410642 + 미커밋 zero-config DX 변경(보존, 별도 커밋 아님)
- 원 요청: "이거 scriptable을 알아서 잘 적용되게 하고 싶어" + 확인 답변: 클라이언트 import 자동화(1안) — "상대경로에 대해서 전혀 몰라도 되며, 같은 프로젝트에 있더라도 알아서 잘 적용"

## 목표와 범위

**사용자에게 달라지는 결과**

1. 어떤 호스트(Next webpack/Turbopack, Webpack/Rspack·Lynx, Vite, Bun 런타임)에서든 앱 코드는 오직
   `import { createClient } from '@scriptcable/client'` 만 쓴다. `.scriptcable/generated/...` 상대경로를 몰라도 된다.
2. 서버 그래프(Node 런타임)와 클라이언트 그래프(브라우저)가 **같은 import 문**으로 각각 맞는 플레이버(node/browser)를
   자동으로 받는다 — export conditions 기반, 앱 코드에 분기 없음.
3. 에디터 TS도 `@scriptcable/client`를 해석한다(tsconfig 수정 없이 — 실제 패키지이므로).
4. `scriptcable build` 후 어디서든 링크가 유지된다(재실행 시 idempotent, 끊어진 링크 자동 복구).

**제외 범위**

- Turbopack 코어 빌드 자동화(predev 스크립트 유지 — 사용자가 1안 선택, 2안 기각)
- tsconfig paths 자동 기록(실제 패키지 링크로 불필요)
- Metro/RN 실기기 검증(환경 없음 — declarative condition만 제공, 한계 명시)
- Tauri/Lynx 네이티브 링크 레시피 변경 없음

**현재 구조와 근거 (조사 완료)**

| 위치 | 현재 동작 |
|---|---|
| `packages/core/src/codegen.ts:315-360` | `generateClients` — 타깃별 `node.ts`/`bun.ts`/`browser.ts`/… + `types.ts` + `index.ts`, 각 파일이 `createClient` 수출. `PROFILE`은 파일마다 베이크 |
| `codegen.ts:156-200` | browser 클라이언트 `createClient(options)` — `options.wasi` **필수** (브라우저 zero-arg 호출 불가) |
| `codegen.ts:100-146` | node 클라이언트 — `__dirname` 기준 shared/wasm 경로. 번들러(Next) 서버 런타임에서 `__dirname`이 `.next/`로 풀려 실패할 잠재 결함 |
| `packages/core/src/wasi-polyfill.ts` | `createMinimalWasi()` 존재 — 브라우저에서 no-arg 기본값으로 쓸 수 있음 (vite-app이 이미 사용) |
| `packages/cli/src/commands/build.ts:37` | 기본 hosts `['node','bun','browser']` |
| `packages/vite/src/index.ts:74-86` | 가상 모듈(`virtual:scriptcable`, `@scriptcable/client`) — 유지(호환) |
| `packages/next/src/index.ts`, `packages/webpack/src/index.ts` | 빌드+codegen만 하고 클라이언트 해석 수단 없음 — 앱이 상대경로 import |
| `packages/cli/src/commands/init.ts` | bun/node 스캐폴드 main.ts가 `createNodeEngine({outDir})` — outDir을 앱이 앎 |
| `packages/core/package.json` exports | `/wasm`, `/native`, `/wasi` 서브패스 존재 — 생성 파일 import 가능 |

**핵심 설계: 진짜 패키지 + export conditions (번들러별 alias 남발 대신 단일 메커니즘)**

`scriptcable build`와 3개 번들러 플러그인이 공유하는 신규 core 헬퍼가:

1. `<outDir>/generated/package.json`에 `@scriptcable/client` 매니페스트를 기록:
   - `".": { "bun": "./bun.ts", "node": "./node.ts", "browser": "./browser.ts", "default": "./<기본>.ts" }` — 생성된 플레이버만 조건으로. default = browser 우선(에디터 TS 포함 비조건 환경), 없으면 node/bun 순.
   - `"./browser" | "./node" | "./bun" | "./react-native" | "./lynx" | "./tauri" | "./*.ts"` 서브패스.
2. `<cwd>/node_modules/@scriptcable/client` 심링크(Windows junction)를 보장:
   - 이미 같은 대상 → no-op. 끊어진 심링크 → 교체. 실제 디렉터/파일 존재 → 건드리지 않음. `node_modules` 없으면 생성.
   - 실패(권한 등)는 치명적 아님 — 상태를 반환해 CLI만 한 줄 로그.

모든 리졸버(webpack/turbopack/vite/bun 런타임/에디터 TS)가 node_modules 패키지를 동일하게 해석하고, conditions로
환경별 플레이버가 결정된다. 앱 코드는 환경 분기도 상대경로도 없다.

**수반 수정**

- `genBrowserClient`: `wasi`를 옵션화, 기본 `createMinimalWasi()`(core/wasi) — 브라우저 no-arg 동작.
- `genNodeClient`: shared/wasm 로드에 cwd 기반 폴백(`join(cwd, outDirRel, 'generated', …)`) — 번들러 서버 런타임에서 `__dirname` 왜곡 대비.
- next: `withScriptcable`이 `transpilePackages: ['@scriptcable/client']` 자동 병합(webpack·turbopack 공통).
- vite/next/webpack 플러그인: 각자 duplicated write 루프 → 공유 `writeGeneratedClients()`(mkdir+write+client package+link)로 교체. vite 가상 모듈 유지.
- CLI build: 클라이언트 패키지+링크 수행, `  client: @scriptcable/client → …` 한 줄 로그.
- doctor: 링크 상태 확인 표시 + 수정 안내(`scriptcable build` 재실행 또는 `"@scriptcable/client": "file:.scriptcable/generated"` 의존성 추가로 CI 내구화).
- init: bun/node 스캐폴드 main.ts를 `@scriptcable/client` import로 교체(outDir 노출 제거).
- 예제: `examples/next-app/src/server-action.ts`를 `@scriptcable/client` import로 전환(실증).
- 문서: README.md/README.ko.md 새 섹션 + CHANGELOG.

**오류·경계**

- node_modules 부재 프로젝트 → `node_modules` 생성 후 링크.
- 심링크 생성 불가(Windows 무권한) → 경고 없이 skip, doctor가 후속 안내.
- 생성 플레이버가 하나뿐(예: `--hosts react-native`) → `.`은 그 플레이버, 서브패스도 그것만.
- package.json 내용 불변 → 재기록 안 함(와처 스팸 방지, CLI 기존 패턴과 동일).

**호환성·롤백**

- 기존 가상 모듈(vite), 엔진 API(`createNodeEngine` 등), 생성 파일 형식 불변 — 추가만 있고 제거 없음.
- git revert 단위 롤백 가능. `generated/package.json` 신규 파일은 구버전 도구가 무시해도 무해.

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | `scriptcable build` 후 앱에서 `import { createClient } from '@scriptcable/client'`가 Bun 런타임에서 실제 코어 함수를 호출한다 (상대경로/엔진 API/파일 경로 지식 없이) | T-1, T-2 | V-1 |
| AC-2 | Next(webpack)에서 `withScriptcable`만 적용하면 서버·클라이언트 그래프가 같은 import로 각각 node/browser 플레이버를 해석한다 (conditions 기반, transpilePackages 자동) | T-1, T-3 | V-2 |
| AC-3 | Webpack/Rspack 플러그인 프로젝트에서도 동일 import가 해석된다 | T-3 | V-3 |
| AC-4 | 브라우저에서 `createClient()` 인자 없이 동작한다 (wasi 기본 제공) | T-1 | V-4 |
| AC-5 | 링크는 idempotent — 재빌드/끊어진 링크/외부 패키지 충돌에서 각각 안전하다 | T-1 | V-5 |
| AC-6 | 에디터/TS 해석: 생성된 패키지가 `types` 진입을 제공해 no-arg 호출이 타입 체크를 통과한다 | T-1 | V-6 |
| AC-7 | doctor가 링크 상태를 보고하고 수정 명령을 안내한다 | T-2 | V-7 |
| AC-8 | init 스캐폴드와 next-app 예제가 상대경로/outDir 지식 없이 클라이언트 import를 사용한다 | T-4 | V-8 |
| AC-9 | README.md/README.ko.md에 자동 적용 사용법 문서화 + 기존 전체 회귀 없음 | T-5 | V-9 |

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 ID | 상태 |
|---|---|---|---|---|---|
| T-1 | core: `client-package.ts`(매니페스트+write+link) + `writeGeneratedClients()` 공유 emit + codegen 수정(wasi 옵션, node cwd 폴백) + 단위 테스트 (AC-1,2,4,5,6) | `packages/core/src/{client-package,codegen}.ts`, `packages/core/src/client-package.test.ts` | 없음 | V-4, V-5, V-6 | done |
| T-2 | CLI: build에 emit+link+로그, doctor에 링크 진단 (AC-1,7) | `packages/cli/src/commands/{build,doctor}.ts`, `build.integration.test.ts` 확장 | T-1 | V-1, V-7 | done |
| T-3 | 플러그인 3종: 공유 emit 전환 + next transpilePackages (AC-2,3) | `packages/{vite,next,webpack}/src/index.ts`, vite plugin.test.ts 유지 | T-1 | V-2, V-3 | done |
| T-4 | init 스캐폴드 + next-app 예제 전환 (AC-8) | `packages/cli/src/commands/init.ts`, `examples/next-app/src/server-action.ts` | T-2 | V-8 | done |
| T-5 | 문서 + 전체 회귀 (AC-9) | `README.md`, `README.ko.md`, `CHANGELOG.md` | T-1~T-4 | V-9 | done |

통합: V-9는 전 태스크 병합 후 수행 (개별 PASS ≠ 통합 PASS).

## 검증 계획

| ID | 방법 | cwd·환경 | 기대 결과 |
|---|---|---|---|
| V-1 | `bun test packages/cli` — 통합 테스트가 tmp 프로젝트 빌드 후 `node_modules/@scriptcable/client` 링크와 Bun 서브프로세스 `import('@scriptcable/client')` → `add(2,3)=5` 실호출 | repo root (scriptc+clang) | 링크 존재 + 실호출 5 |
| V-2 | next-app: `bun run test` (server-action = Bun 런타임 node/bun 플레이버) + fake-next-build 번들 성공 + `transpilePackages` 코드 대조 | examples/next-app | 기존 테스트 통과 + import가 `@scriptcable/client`로 전환됨 |
| V-3 | webpack 플러그인 경로: dx-app/vite 예제 빌드 + plugin.test.ts, 조사로 alias 불필요 확인 | repo root | 기존 검증 재통과 |
| V-4 | codegen 출력 대조 테스트 — browser 클라이언트에 `wasi?` 옵션 + `createMinimalWasi` 기본 존재 | packages/core | 어설션 pass |
| V-5 | client-package 단위 테스트 — 생성/갱신/끊어진 링크 복구/실제 디렉터 보존/node_modules 부재 생성 | packages/core | 전부 pass |
| V-6 | tmp 프로젝트에서 `tsc --noEmit`로 `createClient()` no-arg 호출 타입 통과 (또는 생성 types 대조) | tmp project | 에러 0 |
| V-7 | `scriptcable doctor` 실행 — 링크 상태 라인 출력 확인 | examples/dx-app 등 | 상태 라인 존재 |
| V-8 | init 스캐폴드·server-action.ts 소스 대조 — 상대경로/outDir 리터럴 부재 | repo root | grep 0건 |
| V-9 | `bun run test && bun run typecheck && bun run build` + README 대조 | repo root | 전부 성공 |

## 평가와 인계

- G1 계획: validate-plan plan 모드 self-review — AC↔T↔V 연결, 조사 근거 명시 — PASS
- G3 코드 리뷰 1차: 독립 평가자 위임(Agent) — **FAIL**, 결함 5건
  - F-1 (P1) 플러그인 3종이 `profile` 없이 emit → 추론 exports 누락, 클라이언트에 메서드 없음. 수정: 3 call site에 `profile: result.profile` 전달
  - F-2 (P1) next/webpack(native 타깃)이 산출물을 generated/에 복사 안 함 → `createClient()` ENOENT. 수정: `copy: { sharedPath, wasmPath }` 전달 + codegen SEARCH_DIRS에 outDir 루트 추가(이중 방어)
  - F-3 (P2) 문서가 Next 클라이언트 그래프 브라우저 플레이버를 과대 서술(wasm fetch 404 예상). 수정: README 2종 표·문단 정정(wasmUrl 안내), 브라우저 실호출 미검증은 잔여 한계로 명시
  - F-4 (P3) 플러그인이 링크 blocked를 조용히 무시. 수정: 3종 모두 한 줄 warn 추가
  - F-5 (P3) 심링크 EEXIST 경합 시 'blocked' 오판. 수정: EEXIST 재-lstat 후 'current' 판정
  - 평가자 지시 반영: 플러그인 단독 경로(CLI 빌드·설정 파일 없음, exports 추론 프로젝트) 통합 테스트 신설 — `packages/next/src/plugin.integration.test.ts`(메서드 존재 + dylib 복사 + 링크 + `add(2,3)=5` 실호출). 참고: F-1/F-2 자체는 이전 구조부터 있던 플러그인 동작이었으나, 이번 변경이 해당 경로를 광고하면서 범위 내 결함이 됨
- G3 코드 리뷰 2차(수정 후 재판정): 아래 기록
- G4 사용성·디자인: N/A (UI 변경 없음 — 개발자 워크플로 UX는 AC-1~8이 커버)
- G5 완료: 아래 기록

### G3 2차 재판정

독립 평가자 — F-1~F-5 **전부 수정 충분**(평가자가 /tmp에서 독립 재현: 플러그인 단독 경로 `createClient()` → add(2,3)=5 실호출, preferWasm 경로의 최초 런타임 증거 포함, F-5는 60-way 동시 경합에서 무손상·무오판 입증). 신설 결함 2건:
- F-6 (P3) ci.yml에 next test 스텝 누락 → 수정: `bun run --filter @scriptcable/next test` 추가
- F-7 (P2) 신설 통합 테스트의 `*.dylib` 전용 glob이 Linux(.so)에서 실패 예정 → 수정: `.dylib|.so|.dll` 플랫폼 무관 검사로 교체(cli 테스트 패턴과 정합)

수정 후 `bun test packages/next` 재실행 — 1 pass / 0 fail. 다른 검증은 무관(평가자 확인).

### G3 3차 재판정

독립 평가자 — **PASS**. F-7 해소 확인(`.dylib|.so|.dll` 필터가 link-shared.ts 플랫폼 분기와 정확히 일치), F-6 해소 확인(ci.yml ubuntu·macos 양쪽에서 next test 게이트). 잔여 결함 0건. 무관 검증은 2차 증거 유지(변경이 테스트 파일 1개+CI yaml 1줄뿐이므로).

### G5 완료 — PASS

원 요청("scriptcable을 알아서 잘 적용되게" → 확인 범위: 클라이언트 import 자동화, 상대경로 지식 제로) 대조:

| AC | 최종 증거 |
|---|---|
| AC-1 | CLI 통합 테스트 — 설정 없는 프로젝트 빌드 후 Bun 서브프로세스 `import('@scriptcable/client')` → add(2,3)=5 실호출 |
| AC-2 | next 플러그인 단독 통합 테스트 + 평가자 /tmp 독립 재현(scriptcableBuild()만 실행 → exports 추론·dylib 복사·실호출) + withScriptcable의 transpilePackages 병합 |
| AC-3 | 동일 emit 경로 공유(webpack beforeCompile) + 평가자 vite buildStart 단독 재현 |
| AC-4 | browser 클라이언트 `wasi?` 옵션화 + createMinimalWasi 기본값(codegen 어설션) |
| AC-5 | client-package.test.ts 8케이스(linked/current/repaired/blocked·실제 디렉터 보존·node_modules 자가 생성) + 평가자 60-way 경합 무손상 입증 |
| AC-6 | tsc --strict --module nodenext로 no-arg createClient 해석 확인(에러 0) |
| AC-7 | doctor `client: … ✓` 라인 + blocked 시 수정 안내 분기 |
| AC-8 | init bun/node 스캐폴드·next-app server-action이 상대경로·outDir 리터럴 없이 `@scriptcable/client` 사용 |
| AC-9 | README.md/README.ko.md conditions 표·wasmUrl 레시피(F-3 정정 반영) + CHANGELOG + 전체 test 36 pass·typecheck·build 통과 |

**잔여 한계 (환경 미검증, 결함 아님 — 문서화됨)**

1. 실제 `next dev`/`next build`(webpack·Turbopack)와 브라우저 런타임 미실행 — fake-next-build 시뮬레이션·소스 대조·/tmp 실험 기반. Next 클라이언트 그래프는 wasm 정적 서빙+`wasmUrl` 필요(README 명시).
2. Windows junction, Bun-on-Windows, Metro/RN 실기기 미검증.
3. Node < 22.18 TS config import 한계는 이전 zero-config 계획에서 수신한 것과 동일.

**후속 후보**: 브라우저 실호출 e2e(playwright 등) 도입, `@scriptcable/client` file: 의존성을 doctor가 원클릭 추가, Metro 조건 실증.

- 커밋: 미수행 (사용자 요청 시 commit 스킬로)

## 검증 결과 (구현 후 기록)

| ID | 실제 결과·증거 | 판정 |
|---|---|---|
| V-1 | `bun test packages/cli` — 설정 없는 tmp 프로젝트 빌드 후 `generated/package.json`(name=@scriptcable/client) + `node_modules/@scriptcable/client` 심링크 확인, Bun 서브프로세스 `import('@scriptcable/client')` → `add(2,3)=5` 실호출 | PASS |
| V-2 | next-app: server-action.ts가 `@scriptcable/client`만 import → `{"sum":42,"hi":"hello, next-server"}` 실호출, fake-next-build(webpack wiring + scriptcableBuild) 성공, `transpilePackages` 병합은 withScriptcable 소스로 확인 | PASS |
| V-3 | `bun test packages/vite` 2 pass(HMR 게이팅 포함), example-vite-app 빌드 성공(루트 build), dx-app 빌드는 이전 SDD V-5 경로로 동일 커맨드 확인 | PASS |
| V-4 | client-package.test.ts 어설션: browser.ts에 `wasi?:` + `createMinimalWasi` 기본값 존재 | PASS |
| V-5 | client-package.test.ts 8케이스 — linked/current/repaired(끊어진 링크)/blocked(실제 디렉터 보존, 미생성)/node_modules 자가 생성/매니페스트 서브셋/기록 스킵 | PASS |
| V-6 | `tsc --noEmit --strict --module nodenext` examples/next-app/src/server-action.ts — `createClient()` 무인자가 `@scriptcable/client`(node condition → node.ts)로 해석, 에러 0 | PASS |
| V-7 | next-app에서 `scriptcable doctor` → `client: @scriptcable/client → node_modules ✓` 라인 출력 (blocked 시 수정 안내 분기 포함) | PASS |
| V-8 | init.ts bun/node 스캐폴드 main.ts가 `@scriptcable/client` import(outDir 리터럴 제거), next-app server-action.ts 상대경로 제거 — 소스 대조 | PASS |
| V-9 | `bun run typecheck` 전 패키지 pass · `bun run build` 전 패키지 code 0 · 전체 test 35 pass/0 fail(core 32+cli 1+vite 2 외 기존) · README.md/README.ko.md "임포트 하나" 섹션 + CHANGELOG 기록 | PASS |

변경 후 재검증: codegen WASI 캐스트 추가로 node/bun 플레이버 출력이 바뀌자 V-1(core/cli 재빌드 후), V-6, next-app test를 재실행 — 전부 재통과.

## 태스크 상태 세부

- T-1 done — `client-package.ts` 신규(매니페스트/write/link/공유 emit), codegen(wasi 옵션화·node cwd 폴백·WASI 타입 캐스트), client-package.test.ts 8케이스
- T-2 done — build.ts 공유 emit 전환 + client 로그 라인, doctor.ts 링크 진단·복구, build.integration.test.ts 링크+실호출 확장
- T-3 done — vite/next/webpack 공유 emit 전환, next transpilePackages 자동 병합
- T-4 done — init bun/node 스캐폴드 전환, next-app server-action.ts 전환
- T-5 done — README.md/README.ko.md 새 섹션, CHANGELOG 통합 기록
- 구현 중 수정: (1) 링크 교체 시 'repaired' 반환 누락 → 플래그 추가 (2) writeGeneratedClients 반환형 {genDir, clientLink} 변경에 따른 vite/테스트 디스트럭처링 누락 2건 (3) 생성 node.ts의 node:wasi → loadWasmModule 타입 불일치(패키지화로 생성물이 tsc 프로그램에 편입되어 최초 노출) → 캐스트
