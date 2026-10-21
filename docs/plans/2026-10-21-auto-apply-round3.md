# 자동 적용 3차 — drop-in import 스왑(등록만 하면 빨라진다)

- 날짜: 2026-10-21
- 기준 리비전: main @ 7f84a9d + 작업 트리의 2차 자동 적용 변경(커밋 전, 보존)
- 원 요청: "그냥 플러그인을 등록만 하면 알아서 성능이 높아지게" + "vite뿐 아니라 rn, electron, lynx 등 다양한 프로젝트에서도". [[auto-apply-dx-north-star]] — 앱 코드가 알아야 것을 줄인다. 마지막 수동 단계는 **앱 코드의 import를 `@scriptcable/client`로 고쳐 쓰는 일**이다.

## 목표와 범위

**사용자에게 달라지는 결과**

1. **F-1 drop-in 클라이언트 코드젠**: 빌드가 원본 core.ts와 **동일한 이름·시그니처·JSDoc의 named export**를 갖는 drop-in 모듈을 추가 생성한다. 브라우저 플레이버는 TLA로 초기화, node/bun 플레이버는 **TLA 없는 `createClientSync()`**(애드온 → 공유 라이브러리 → 네이티브 부재 시 안내 오류), react-native는 브릿지 lazy 싱글톤.
2. **F-2 플러그인 import 가로채기**: vite는 `resolveId`, webpack/rspack/next(webpack)는 **enhanced-resolve 플러그인**(상대/절대 요청이 엔트리로 귀결되면 drop-in으로 리다이렉트)으로 엔트리 모듈 import를 몰래 스왑한다. 앱 코드 변경 0.
3. **F-3 정확한 폴백**: 엔트리에 ABI 매핑 불가 런타임 export(함수 아닌 값, default export, re-export, 화살표 함수 export)가 하나라도 있으면 **그 프로젝트는 가로채지 않고** 이유 1줄을 알린다(correctness > speed). `dropin: false` 옵션으로 수동 opt-out.
4. **F-4 호스트 확장**: RN(Metro)은 `resolveRequest` 헬퍼, Lynx/Rspeedy는 Rspack(webpack 플러그인 동일 경로), Electron은 문서 레시피(main=export conditions 기존 경로, renderer=vite/webpack drop-in). Turbopack은 `turbopack.resolveAlias` 생성 헬퍼.

**제외 범위**

- 실제 Next(Turbopack)·Rspeedy·Metro 런타임 e2e — 레포에 해당 호스트 미설치. 설정 생성+단위 검증까지만, 한계 문서화
- Bun/Node 무번들러 실행의 import 스왑(번들러 플러그인 전제) — 기존 `@scriptcable/client` 직접 import 안내
- RN 기기 브릿지의 동기화(TurboModule 호출은 기기에서 Promise — 기존 RN 클라이언트와 동일 시맨틱, 문서화)

**현재 구조와 근거 (조사 완료)**

| 위치 | 현재 동작 |
|---|---|
| `packages/core/src/codegen.ts:180` | node 클라이언트 `createClient` 비동기만 존재 — 동기 초기화 경로 없음 |
| `packages/core/src/native-loader.ts:256` | `loadNativeLibrary` async 래퍼 — 실제 dlopen/koffi.load는 동기, `await import`만 비동기 |
| `packages/core/src/infer.ts:101` | `export function`만 수집 — 함수 아닌 export 탐지 없음 → 가로채기 안전성 판정 불가 |
| `packages/webpack/src/index.ts:30` | beforeCompile 빌드만 — 해석 단계 개입 없음 |
| `packages/vite/src/index.ts:96` | resolveId가 `@scriptcable/client`만 브라우저 플레이버로 매핑 |
| `packages/core/src/client-package.ts:182` | `writeGeneratedClients`가 단일 emit 지점 — drop-in 파일 추가 위치 |
| webpack alias | 원본 request 문자열에만 적용 → 상대 import('./core')엔 무효, resolver 플러그인 필요 |
| `loadNativeLibrary` 호출 그래프 | 바인딩 생성(dlopen·koffi.load·심볼 테이블)은 전부 동기 구성 가능 |
| 예제 next-app/lynx-app | 실제 Next/Rspeedy 미설치 — fake-next-build 시뮬레이션, 런타임 검증 한계 |
| `examples/vite-app` | 실제 vite 6 설치 — `vite build` E2E 가능 |

**환경·도구**: Bun 1.4.x, bun:test, scriptc 0.3.6 + clang + zig. TLA 브라우저 검증은 vite build 실 E2E로 대행.

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | 생성 node/bun 클라이언트에 `createClientSync()`가 있다: 애드온 → 공유 라이브러리 순 동기 로드, 네이티브 부재 시 "scriptcable build를 먼저" 안내 오류. 실제 빌드 산출물로 `add(20,22)===42` 런타임 확인 | T-1 | V-1 |
| AC-2 | 빌드가 `dropin/browser.ts`(TLA), `dropin/node.ts`(sync), `dropin/react-native.ts`(lazy bridge)를 플레이버별로 생성하고, export 이름·파라미터명·JSDoc이 원본과 일치한다 | T-2 | V-2 |
| AC-3 | 엔트리에 매핑 불가 런타임 export가 있으면 가로채기가 꺼지고 이유 1줄이 출력된다. 전부 매핑 가능하면 켜진다. 명시적 `exports` 선언 시 엔트리 전체 표면과 비교한다 | T-2 | V-3 |
| AC-4 | vite 플러그인이 엔트리로 해석되는 import를 drop-in/browser.ts로 스왑하고, 실제 `vite build` 산출물이 drop-in을 사용한다 | T-4, T-8 | V-4 |
| AC-5 | webpack 플러그인이 resolve.plugins에 리다이렉트 플러그인을 넣고(중복 푸시 없음), 상대/절대 엔트리 요청만 drop-in으로 돌린다(옵션 browser/node) | T-3, T-5 | V-5 |
| AC-6 | next webpack 그래프: client→browser drop-in, server/edge→node drop-in. Turbopack용 `withScriptcableAsync`가 `turbopack.resolveAlias`를 생성한다(런타임 검증은 미설치로 제외, 문서 표기) | T-6 | V-6 |
| AC-7 | RN: `withScriptcableMetro(config, opts)`가 엔트리 요청을 dropin/react-native.ts로 리다이렉트하고 나머지는 기본 해석으로 위임한다 | T-7 | V-7 |
| AC-8 | Lynx(Rspeedy)·Electron·Turbopack·무번들러 레시피가 README/ko에 문서화된다 | T-9 | V-8 |
| AC-9 | 전체 회귀(test/typecheck/build + 예제) 통과, CHANGELOG 갱신 | T-9 | V-9 |

## 설계

**F-1 (core: sync 네이티브 + drop-in 코드젠)**

- `native-loader.ts`: 심볼 테이블·바인딩 생성을 동기 본문으로 추출하고 `loadNativeLibrarySync(sharedPath, profile)` 추가 — Bun은 `createRequire(...)('bun:ffi')`, Node는 `('koffi')` 동기 require. 기존 async 경로는 동기 본문 재사용(동작 불변).
- `genNodeClient`에 `createClientSync(options?)` 추가: `createRequire(import.meta.url)`로 SEARCH_DIRS 순회 `require(애드온)` → `loadNativeLibrarySync(공유)` → 둘 다 없으면 안내 오류(throw). `bun.ts`는 헤더 치환으로 상속. 정적 import만 사용 — TLA/CJS 양쪽 안전.
- `codegen.ts`에 drop-in 종 생성:
  - `dropin/browser.ts`: `const client = await createClient()` + `export function add(...)` 원본 시그니처 + `getScriptcableClient()`. `../browser.js` 상대 import(.js→.ts 해석은 vite/next 모두 기존 생성물이 이미 사용·검증된 패턴).
  - `dropin/node.ts`: `const client = createClientSync()` + 동일 export.
  - `dropin/react-native.ts`: `let c; const client = () => c ??= createClient(createTurboModuleBridge(NativeCable))` + 동일 export(`../react-native.js`, `../NativeCable.js`, `@scriptcable/react-native`).
- 생성 조건: 대상 targets에 해당 플레이버가 있을 때만. `writeGeneratedClients`를 통해 모든 호출자(CLI/플러그인)가 자동 수혜.

**F-3 (core: 가로채기 안전 판정)**

- `infer.ts`에 `analyzeEntryExports(source)`: 최상위 export 문 스캔 — `export function`은 추론 결과와 대조, 그 외 런타임 export(`export const/let/class`, `export {a,b}`, `export *`, re-export, `export default`)는 `{name, reason}` 수집. `export type/interface`은 제외(런타임 부재).
- `intercept.ts`: `canInterceptEntry(config, cwd, profile)` — 엔트리 소스 읽어 (a) `skipped` 없음 (b) 비함수 export 없음 (c) export 이름 집합 == profile.exports 집합. 위반 시 reasons 배열. 플러그인은 실패 시 `[scriptcable] drop-in disabled: …` 1줄.

**F-2/F-4 (호스트 플러그인)**

- core에 `createDropinResolvePlugin(entryBaseNoExt, dropinPath)`(webpack 계열 공용): `resolver.getHook('resolve')`에서 상대/절대 요청만 `path.resolve(request.path, request.request)` 후 확장자 제거·비교 → 엔트리면 `doResolve`로 drop-in 절대경로 리다이렉트, 그 외는 기본 해석 위임. `entryBase`는 엔트리 절대경로 확장자 제거.
- vite: `resolveId` 확장 — `this.resolve(id, importer, {skipSelf:true})` 결과가 entryAbs면 drop-in/browser.ts 반환. 옵션 `dropin?: boolean`(기본 true). 빌드 실패·비가로채기 시 기존 동작.
- webpack: 옵션 `dropin?: 'browser'|'node'|false`(기본 'browser'). beforeCompile 빌드 후 `canInterceptEntry` 통과 시 `compiler.options.resolve.plugins`에 플러그인 1회 푸시(플래그로 dedupe).
- next: `withScriptcable`의 webpack 훅에서 `ctx.isServer`로 플레이버 선택(server/edge→node, client→browser) — 같은 core resolve 플러그인 사용. `withScriptcableAsync(nextConfig, opts)`: config 해석 후 `turbopack.resolveAlias` 병합 생성(TLA인 next.config.mjs에서 await).
- react-native: `withScriptcableMetro(config, {entry?, cwd?})` — sync fs로 엔트리 추론(표준 위치) 또는 명시 경로. resolveRequest: 엔트리 귀결 요청 → `{type:'sourceFile', filePath: dropin 경로}`, 나머지는 `context.resolveRequest` 위임. dropin 경로는 `.scriptcable/generated/dropin/react-native.ts`(미빌드 시 위임=기존 동작).

**오류·경계**

- drop-in은 엔트리 모듈 정체를 대체 — 엔트리 자체를 drop-in이 import하지 않음(순환 없음). `import type`은 런타임 import가 아니어서 영향 없음.
- TLA: 브라우저 계열만. 웹 번들(ESM) 표준 지원. TLA 불가 호스트는 `dropin: false`.
- webpack dev 재빌드: beforeCompile마다 dedupe 확인 — 플러그인 중복 푸시 없음.
- Metro/Next/Rspeedy 미설치 환경: 해당 런타임 e2e는 미검증으로 문서에 명시(설정 생성은 단위 검증).

**호환성·롤백**

- 기존 `@scriptcable/client` import 흐름 불변 — drop-in은 추가 파일+옵트아웃 가능한 리다이렉트. 생성물 내용 변화는 신규 파일뿐. 각 호스트 기능 독립 커밋으로 롤백 가능.

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 ID |
|---|---|---|---|---|
| T-1 | sync 네이티브 로더 + `createClientSync` (AC-1) | `packages/core/src/native-loader.ts`, `codegen.ts` | 없음 | V-1 |
| T-2 | drop-in 코드젠 + 엔트리 안전 판정 (AC-2,3) | `packages/core/src/{codegen,infer}.ts`, 신규 `packages/core/src/intercept.ts`, `codegen.test.ts` | T-1 | V-2, V-3 |
| T-3 | webpack 계열 resolve 플러그인 (AC-5) | 신규 `packages/core/src/dropin-resolve.ts` + 단위 테스트 | 없음 | V-5 |
| T-4 | vite resolveId 가로채기 (AC-4) | `packages/vite/src/index.ts`, `plugin.test.ts` | T-2 | V-4 |
| T-5 | webpack 플러그인 연결 (AC-5) | `packages/webpack/src/index.ts`, `plugin.test.ts` | T-2, T-3 | V-5 |
| T-6 | next 그래프별 연결 + Turbopack 헬퍼 (AC-6) | `packages/next/src/index.ts`, `plugin.integration.test.ts`, `examples/next-app/scripts/fake-next-build.mjs` | T-2, T-3 | V-6 |
| T-7 | Metro resolver 헬퍼 (AC-7) | `packages/react-native/src`(신규 metro 모듈) + 테스트 | T-2 | V-7 |
| T-8 | 예제 E2E — vite-app dropin 스모크 (AC-4) | `examples/vite-app/src`, `package.json` | T-4 | V-4 |
| T-9 | 문서·레시피·회귀 (AC-8,9) | `README.md`, `README.ko.md`, `CHANGELOG.md` | T-1~T-8 | V-8, V-9 |

## 검증 계획과 결과

| ID | 방법 | 기대 | 실제 결과 | 판정 |
|---|---|---|---|---|
| V-1 | webpack 플러그인 빌드로 실제 산출 생성 → 생성 `node.ts`·`dropin/node.ts` 동적 import → `createClientSync().add(20,22)` | 42, 동기 반환 | plugin.test.ts "drops in" — `client.add(20,22)===42`, `dropin.add(20,22)===42`, 싱글톤 `getScriptcableClient().add(3,4)===7` | PASS |
| V-2 | `bun test packages/core` — drop-in 3종 존재·시그니처·JSDoc·TLA/sync/lazy 형태 검사 | 신규 케이스 pass | codegen.test.ts drop-in 5 pass (paramNames 유·무, 플레이버 조건부 생성, createClientSync 구조) | PASS |
| V-3 | intercept 단위 테스트 — 비함수 export·class·re-export·default·타입 전용·프로필 불일치·엔트리 부재 | ok:false + reasons | intercept.test.ts 7 pass (`export { … } from`이 modifier 없음을 발견해 infer.ts 수정 후 통과) | PASS |
| V-4 | `bun test packages/vite` + vite-app 실서버 스모크(`transformRequest`로 import 재기록 확인) + `vite build` | 실제 vite가 drop-in으로 해석 | vite 2 pass; dropin-smoke OK — `dropin/browser.ts` 참조, 원본 core 미등장. `vite build`는 TLA로 실패 → 예제 `build.target: 'es2022'` 명시 후 성공 (문서에 요구사항 기재) | PASS |
| V-5 | `bun test packages/webpack` + dropin-resolve 스텁 resolver 단위 테스트 | 리다이렉트/위임/1회 푸시 | webpack 4 pass (푸시·재빌드 dedupe·`dropin:false`·LIMIT 폴백), dropin-resolve.test.ts 4 pass | PASS |
| V-6 | `bun test packages/next` + fake-next-build가 client/server 두 그래프 게이트 가동 단언 | 두 그래프 모두 구성 확인 | next 2 pass; fake-next-build OK — "browser client"/"node client" 로그 + turbopack.resolveAlias 생성 확인 | PASS |
| V-7 | `bun test packages/react-native` — 스텁 context resolveRequest | 엔트리→drop-in, 타 요청 위임, 기존 resolver 우선 | metro.test.ts 6 pass | PASS |
| V-8 | 문서 검수 — README/ko 레시피(vite/webpack/next/turbopack/RN/Electron/Lynx) + 한계 표기 | 기재 확인 | README.md·README.ko.md에 "Zero changes: the drop-in"/"변경 0: drop-in" 절 + 호스트 표 + 한계 3줄, CHANGELOG Unreleased 3항목 | PASS |
| V-9 | `bun run test && bun run typecheck && bun run build` + 예제 회귀 | 전부 성공 | 패키지 84 pass / 0 fail, typecheck 12/12, build 12/12; vite-app(4단계)·next-app·lynx-app PASS | PASS |

통합: V-9는 전 태스크 병합 후 수행 완료. G3 코드 리뷰는 독립 평가자(code-reviewer 에이전트)에게 diff·원 요청·검증 기록을 전달해 판정.

## 잔여 한계

- Turbopack·Metro·Rspeedy 런타임 e2e는 레포에 호스트가 없어 **설정 생성+단위 수준까지만 검증** (V-6/V-7). 실제 호스트 설치 환경에서 확인 필요.
- 브라우저 drop-in은 TLA 필수 → 앱 빌드 타깃 ES2022+ 요구(vite는 게이트가 자동 판정, 예제에 `build.target: 'es2022'`로 시연). TLA 불가 호스트는 `dropin: false`.
- `withScriptcableAsync`의 Turbopack `resolveAlias` 절대경로 키 지원은 문서상 확인 필요(호스트 미설치).
- RN 기기에서 TurboModule drop-in 호출은 Promise 귀결(원본은 동기) — 기존 브리지 클라이언트와 동일 시맨틱, README 명시.

## G3 리뷰 결함과 수정 (독립 평가자 FAIL → 수정)

| ID | 심각도 | 결함 | 수정 | 재검증 |
|---|---|---|---|---|
| F-1 | P1 | vite 5/6 기본 빌드 타깃(modules→safari14)이 TLA 거부 — 기본 ON 가로채기가 `vite build`를 깸 | vite 플러그인이 `config.command==='build'`에서 `build.target`(미설정 시 vite 버전별 기본, peer 미해석 시 보수적 modules)을 `targetSupportsTla`로 판정해 미지원 시 가로채기 자동 비활성+해결 안내 1줄. webpack 옵션 문서에 CJS 서버 번들 flavor 안내 추가 | plugin.test.ts 게이트 케이스(빌드+pre-TLA→null, es2022→on, serve→on) |
| F-2 | P2 | `analyzeEntryExports`가 enum·namespace·구조분해 export를 놓침 → 가로채기 ON에서 미제공 export로 파손 | 3종을 unmapped로 탐지 추가. 선택적/기본 매개변수 함수도 drop-in 시맨틱 보존 불가로 unmapped | intercept.test.ts 신규 2케이스 |
| F-3 | P2 | 명시적 `exports` 선언 시 paramNames·JSDoc 소실(vite-app 등 대표 예제가 AC-2 불충족) | `resolveProfile` explicit 분기에서 소스 추론을 병합(이름 기준, 소스 부재 시 위치 인자 폴백) | profile.test.ts 신규 2케이스 |
| F-4 | P2 | `withScriptcableAsync`가 Turbopack alias를 무게이트 설정 — unmappable 프로젝트 빌드 파손 가능 | `canInterceptEntry` + drop-in 파일 존재 확인 통과 시에만 alias 설정, 실패 시 이유 1줄 | fake-next-build(대상 예제 ok 경로) + next 플러그인 테스트 회귀 |
| F-5 | P3 | edge 런타임에 node drop-in(node:fs) 유입 가능 | `nextRuntime==='edge'`면 가로채기 비활성(`@scriptcable/client`로 폴백) | 코드 검수 (edge 호스트 미설치) |
| F-6 | P3 | vite `publicDir:false`인데 public/ 생성 | 명시 false면 복사 생략 | 코드 검수 |
| F-7 | P3 | enhanced-resolve 실라이브러리 검증 부재 | 루트 devDep `enhanced-resolve@5.26.0` 추가 + 실 resolver 통합 테스트(리다이렉트·위임·/var realpath 정규화) | dropin-resolve.test.ts 통합 케이스 |

수정 후 전면 재검증: 패키지 90 pass / 0 fail, typecheck 12/12, build 12/12, 예제 vite-app·next-app·lynx-app PASS. (리뷰 시점 측정 91 pass는 집계 범위 차이 — 본 문서 기준 90.)

**G3 재심사: PASS** (동일 평가자, 독립 실행 검증 — F-1 원 재현 시나리오가 경고 1줄+원본 폴백으로 봉인됨, F-3은 실생성 dropin 산출물에서 `add(a, b)`+JSDoc 확인, F-7 실 enhanced-resolve 리다이렉트 확인). 잔여 P3(비차단): ① dropin-smoke 종료 레이스 → 수정 완료(process 가드, exit 0 확인), ② `targetSupportsTla` 핀 테이블 밖 이형 타깃명 관대 통과(안전 방향), ③ 전 라운드 수용분(watch 스테일 탭, metro existsSync 비용, `export { type X }` 오탐, RN 기기 Promise 시맨틱, 구버전 Next edge 미판별). 확인 불가: 실 Next/Turbopack/Metro/Rspeedy/edge 런타임 e2e — 잔여 한계와 동일.



