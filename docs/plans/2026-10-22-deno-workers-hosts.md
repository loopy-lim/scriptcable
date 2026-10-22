# 런타임·호스트 커버리지 완성 — Deno·Workers 신규 지원 + Nuxt/Remix/SolidStart 실증

- 날짜: 2026-10-22
- 기준 리비전: main @ 226b02a (작업 트리 clean)
- 원 요청: "typescript를 사용하는 대부분의 프로젝트에서 이거 scriptable만 추가하면 알아서 모든것들이 잘 되는 수준" + "다양한 것들을 조사하고 모든 곳에서 지원하게" + "모바일, 데스크탑 앱 부분에서와 웹부분을 위주로" + "DX의 경험을 zeroconfig에 가깝게"
- 선행: [[platform-coverage]] (2026-10-22) — Electron/Expo/Astro/SvelteKit/Rollup 실검증 완료. 이번 라운드는 그 잔여 한계를 좁힌다.

## G0 intake (validate-plan intake 모드 — self-review, PASS)

**목표**: README 호스트 표의 남은 미실증 셀(Nuxt/Remix/SolidStart — 레시피만)을 실빌드로 전환하고, "Not supported" 표기된 **Deno**와 **Cloudflare Workers**를 drop-in DX 그대로 지원한다 — 앱 코드 0 변경, 설정 추가 없이 export 조건 해석만으로.

**관찰 가능한 AC로 전환한 결과**: 아래 수락 기준 표. 막힌 결정 없음.

**범위 밖 (기존 한계 유지)**:
- RN/Lynx 온디바이스 브리지 호출 — 기기·에뮬레이터 없음(BLOCKED 영역, 문서 표기 유지)
- Turbopack/Rspack drop-in — 아키텍처상 불가가 실증·문서화됨(conditions 경로는 동작). 재시도 아님
- iOS/Android 네이티브 아카이브 링크 — 사용자 환경(Xcode/NDK) 몫
- Electron 패키징(electron-builder/forge) — 런타임 검증은 완료된 별도 영역

## 현재 구조와 근거 (조사 완료, 2026-10-22 실측)

| 위치 | 현재 동작 / 실측 사실 |
|---|---|
| `README.md:111` | Astro/SvelteKit은 실검증, Nuxt/Remix/SolidStart는 "follow the same Vite hook" 레시피만 |
| `README.md:370` | "Not supported: Deno and Cloudflare Workers as core clients" — 이번 라운드의 제거 대상 |
| `packages/core/src/client-package.ts:29-67` | 조건 매핑 `CONDITION_BY_TARGET`(bun/node/browser/lynx/react-native/tauri), `DOT_CONDITION_ORDER`(bun,node,browser,…), `RUNTIME_FLAVORS=['bun','node']`(→ .js 트랜스파일) — deno/workers 항목 없음 |
| **Deno 실측 프로브**(2026-10-22, deno 2.9.6) | ① node_modules 하위 .ts 타입 제거 불가(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) → **deno flavor는 .js로 emit 필수** ② Deno는 npm 패키지 해석에 `node` 조건을 기본 포함 → exports first-match에서 `deno` 조건이 `node`보다 **앞**이어야 deno flavor가 선택됨(실측: deno.ts가 먼저 잡히는 것 확인) ③ `with { type: 'webassembly' }` 미지원("import attribute type of webassembly is unsupported") → `Deno.readFile(new URL(...))` + `WebAssembly.compile` 경로 ④ 실제 calculator.wasm을 최소 WASI 폴리필로 인스턴스화해 `calc_add(20,22)=42` 실측 — 코어 메커니즘 성립 |
| `packages/core/src/wasm-loader.ts:275-332` | `loadWasmModule`이 `module:` 옵션(사전 컴파일 모듈) 지원 — Workers의 정적 wasm import(esbuild CompiledWasm)와 바로 결합 |
| `packages/core/src/wasi-polyfill.ts` | `createMinimalWasi` — 순수 JS(node import 없음) → workerd/V8-isolate 안전 |
| `packages/core/src/codegen.ts:301-401` | 브라우저 flavor: fetch HEAD 프로브 + compileStreaming + import.meta.url. `@scriptcable/core/wasm`·`/wasi` bare import — `packages/core/package.json` exports에 `import` 조건으로 존재(확인) |
| `packages/vite/src/index.ts` | resolveId 객체형(order:'pre') — Astro/SvelteKit에서 무수정 실증. Nuxt/RR/SolidStart는 전부 Vite 임베드 → 동일 경로 기대 |
| 레지스트리 실측 | wrangler 4.151.3, nuxt 4.6.2, @react-router/dev 8.5.0(React Router v8 — Remix 계승), @solidjs/start 2.0.6(SolidStart 2 — 순수 Vite 플러그인), deno(npm) 설치 성공 → deno 2.9.6 |
| 환경 | WSL2, bun 1.4.3, node 24.22.1, zig PATH export 필요(~/.tools), 테스트 전 `bun run build` 필요, sudo 불가(유저공간 설치로 해결됨) |

**확인된 검증 명령**(루트): `bun run test` / `typecheck` / `build`, 예제별 `bun run --filter '<name>' test|start`. CI: `.github/workflows/ci.yml`.

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | **Deno**: 새 Deno 프로젝트에서 `import { createClient } from '@scriptcable/client'` + `deno run -A main.ts`만으로 네이티브급 WASM 코어 호출이 된다 — 설정 파일·컴파일러 플래그 0. `examples/deno-app`에서 add(20,22)===42와 greet 문자열 실측. deno flavor는 .js로 emit되고 매니페스트 `deno` 조건이 `node`보다 선행. (G2 문구 갱신: named 함수 직접 import는 번들러 drop-in 전용이고 모든 flavor는 `createClient()` 팩토리 API로 일관 — CLI 런타임에서 TLA 부작용 모듈보다 패리티가 맞음) | T-1, T-2 | V-1, V-6 |
| AC-2 | **Cloudflare Workers**: worker 번들이 스크립터블 클라이언트를 포함하고, 로컬 workerd 런타임(`wrangler dev`)의 HTTP 응답으로 add(20,22)===42가 실측된다. `examples/workers-app` — 앱 코드는 bare import만. 번들에는 workers flavor와 wasm이 포함되고 원본 엔트리 소스는 배제 | T-3, T-4 | V-2 |
| AC-3 | **Nuxt**: 실제 `nuxt build` 산출물(클라이언트 번들)에 drop-in 클라이언트가 포함되고 원본 엔트리 소스는 배제되며 `.wasm`이 정적 산출로 포함된다 — `examples/nuxt-app` | T-5 | V-3 |
| AC-4 | **React Router v8(Remix 계승)**: 실제 `react-router build` 산출물에 대해 AC-3과 동일 단언 — `examples/remix-app` | T-6 | V-4 |
| AC-5 | **SolidStart 2**: 실제 호스트 빌드에서 drop-in 성립 여부를 실증으로 판정한다 — 성립 시 AC-3과 동일 단언의 스모크 예제를 남기고, 불가 시 재현 가능한 실패 증거와 사유를 README에 문서화한다 | T-7 | V-5 |
| AC-6 | **회귀 없음 + 문서**: 전 패키지 test/typecheck/build 통과, 기존 예제(vite/next/node/bun/electron/astro/sveltekit/rn) 회귀 통과, README(영/한) 호스트 표·한계 절 갱신("Not supported"에서 Deno/Workers 제거), CHANGELOG, troubleshooting, 신규 예제가 CI에 연결 | T-8 | V-6 |

## 설계

**T-1 Deno flavor (core)**
- `codegen.ts`: `genDenoClient` — 브라우저 flavor 골격 재사용하되 WASM 해석을 `Deno.readFile(new URL(WASM_FILE, import.meta.url))` → `WebAssembly.compile`로 대체(fetch 프로브 불필요 — 파일이 모듈 옆에 항상 있음). `CodegenTarget`에 `'deno'` 추가.
- `client-package.ts`: `CONDITION_BY_TARGET`에 `deno: { condition: 'deno', file: 'deno.ts' }`, **`DOT_CONDITION_ORDER`는 deno를 bun/node 사이? — 정확히는 `node`보다 앞, bun 다음**(`['bun','deno','node',…]` — Deno 런타임은 bun 조건이 없고 node 조건이 켜지므로 deno 먼저 매칭), `RUNTIME_FLAVORS`에 `'deno'` 추가(Deno는 node_modules 하위 .ts 실행 불가 — 실측) → .js 트랜스파일 emit.
- 테스트: `client-package.test.ts` — deno 타깃 매니페스트 조건 순서·.js 포인팅 단언, `codegen.test.ts` — deno.ts 템플릿 골격 단언.

**T-2 examples/deno-app**
- `main.ts`: `import { add, greet } from '@scriptcable/client'` + 단언(42, greet) → exit code. `scriptcable build`로 클라이언트 생성(bun install은 저장소 루트 워크스페이스가 흡수).
- `test`: `scriptcable build --hosts browser…?` — deno 타깃은 신설이므로 CLI hosts 목록에 `deno` 추가(`build --hosts deno`). deno run 실행은 PATH(~/.bun/bin) 전제 — CI에서 setup-deno.

**T-3 Workers flavor + 조건 프로브 (core)**
- `codegen.ts`: `genWorkersClient` — `import wasmModule from './<name>.wasm'`(esbuild CompiledWasm) + `loadWasmModule({ module: wasmModule, wasi: createMinimalWasi() })`. top-level await 없는 createClient(동기 인스턴스화 아님 — async 유지). `*.wasm` 타입 선언 d.ts를 같이 emit.
- `client-package.ts`: `workers: { condition: 'workerd', file: 'workerd.ts' }` — Cloudflare 표준 조건. **구현 초반 프로브**: wrangler 번들에 'workerd' 조건이 실제로 활성인지 문자열 마커로 확인(비활성 시 browser 조건 우선순위 재검토 — 근거 남기고 설계 갱신).
- workers flavor는 번들러 처리(.ts 유지) — RUNTIME_FLAVORS에 넣지 않음.

**T-4 examples/workers-app**
- wrangler.toml(main, compatibility_date), src/index.ts: bare import로 클라이언트 생성 후 `fetch` 핸들러가 JSON으로 add(20,22) 반환.
- `test`: `scriptcable build` → `wrangler deploy --dry-run --outdir`(번들 성립) → `wrangler dev` 백그라운드 기동 + curl로 42 단언 + 프로세스 정리. workerd가 WSL2에서 구동 불가하면 BLOCKED로 기록(성공으로 갈아치우지 않음) — 단, 시도는 유저공간 설치 등으로 최선.

**T-5 Nuxt (`examples/nuxt-app`)**
- nuxt.config.ts: `vite: { plugins: [scriptcable()] }` + ssr:false(클라이언트 그래프가 drop-in 대상 — SvelteKit 실증과 동일 판형). `nuxt build` → `.output/public` 산출물 단언(drop-in 문자열 포함/원본 엔트리 소스 배제/wasm 산출 — minify-safe 리터럴).

**T-6 React Router v8 (`examples/remix-app`)**
- react-router.config.ts(ssr:false, SPA) + vite.config에 플러그인. `react-router build` → `build/client` 산출물 단언 동일.

**T-7 SolidStart 2 (`examples/solidstart-app`)**
- `@solidjs/start` 2.0.6의 vite 플러그인(`@solidjs/start/vite`) app 진입에 scriptcable() 추가. `npm run build`(vite 빌드) → 산출물 단언. 신버전 리스크 — 실패 시 재현 증거+README 문서화가 AC-5의 합법적 종착점(성공으로 위장 금지).

**T-8 문서·CI·회귀**
- README.md/ko: 호스트 표 — Nuxt/RR/SolidStart 셀을 실측으로, Deno/Workers 행 신설, "Not supported" 절에서 제거(또는 남은 한계만 표기), 각 절 레시피.
- docs/troubleshooting.md: deno(node 조건이 먼저 잡히는 문제, .ts 제거 불가)·wrangler(workerd 조건, wasm import) 실측 항목.
- CHANGELOG Unreleased, ci.yml에 deno/workers/nuxt/remix/solidstart 스텝(deno는 setup-deno 또는 bun i -g deno — 설치 방식은 로컬과 동일하게).

## 오류·경계

- **Deno bare import 자동설치**: generated 패키지가 `@scriptcable/core`를 의존으로 명시하지 않아 Deno가 못 찾으면 레지스트리 페치 시도 → 워크스페이스 루트 node_modules로 walk-up 해석됨(프로브로 node_modules 해석 확인). 예제는 저장소 안에서 검증 — 독립 Deno 프로젝트에서의 `file:` 의존 설치 경로는 README 레시피로 커버(init이 `"@scriptcable/client": "file:.scriptcable/generated"` 기록).
- **workerd 조건 비활성 가능성** → 프로브 우선. browser 조건만 켜진다면: workers 타깃 전용 매니페스트에서 browser 매핑을 workerd 파일로 대체하는 정책(단일 타깃 프로젝트 기준, 혼합 프로젝트는 README 명시) — 구현 중 근거와 함께 결정.
- **wrangler dev 포트 충돌/기동 지연** → 포트 지정 + 재시도 폴링 + 확실한 프로세스 정리.
- **Nuxt/RR/SolidStart SSR 그래프** → ssr:false로 클라이언트 그래프만 검증(Astro/SvelteKit에서 실증된 판형). SSR 켠 케이스는 범위 밖, 문서 표기.
- **SolidStart 2 신버전 변동** → 실패는 결함이 아니라 AC-5의 관찰 결과 — 재현 출력과 사유를 남긴다.
- minify 산출물 단언은 문자열 리터럴 기준('profile_format' 등) — 심볼명 단언 금지(기존 교훈).

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 ID |
|---|---|---|---|---|
| T-1 | Deno flavor 지원 (AC-1) | `packages/core/src/codegen.ts`, `client-package.ts`, 대응 테스트 | 없음 | V-1(단위) |
| T-2 | Deno 예제 스모크 (AC-1) | 신규 `examples/deno-app/*`, CLI hosts에 deno | T-1 | V-1 |
| T-3 | Workers flavor + 조건 프로브 (AC-2) | `packages/core/src/codegen.ts`, `client-package.ts`, 대응 테스트 | 없음 | V-2(번들부) |
| T-4 | Workers 예제 스모크 (AC-2) | 신규 `examples/workers-app/*` | T-3 | V-2 |
| T-5 | Nuxt 실빌드 스모크 (AC-3) | 신규 `examples/nuxt-app/*` | 없음 | V-3 |
| T-6 | React Router v8 실빌드 스모크 (AC-4) | 신규 `examples/remix-app/*` | 없음 | V-4 |
| T-7 | SolidStart 2 실빌드 판정 (AC-5) | 신규 `examples/solidstart-app/*` 또는 README 문서화 | 없음 | V-5 |
| T-8 | 문서·CI·회귀 (AC-6) | `README.md`, `README.ko.md`, `CHANGELOG.md`, `docs/troubleshooting.md`, `.github/workflows/ci.yml` | T-1~T-7 | V-6 |

## 검증 계획과 결과

| ID | 방법 | 기대 | 실제 결과 | 판정 |
|---|---|---|---|---|
| V-1 | `bun run --filter @scriptcable/example-deno-app test` (scriptcable build 후 `deno run -A main.ts`) | exit 0, add=42, greet 문자열 | `{"sum":42,"product":42,"hi":"hello, deno"}` + "deno smoke OK", exit 0 (deno 2.9.6, 플래그·deno.json 0) | PASS |
| V-2 | `bun run --filter @scriptcable/example-workers-app test` — build → `wrangler deploy --dry-run --outdir` → `wrangler dev` + HTTP fetch 단언 | dry-run 성공, 응답 42, 번들에 workerd flavor·wasm 포함 | 번들 단언 통과(로더 체인+flavor 포함, 원본 소스 배제, `<hash>-calculator.wasm` emit) + 실제 workerd 응답 `{"sum":42,"product":42,"hi":"hello, workers"}`, "workers smoke OK", exit 0 (wrangler 4.151.3) | PASS |
| V-3 | `bun run --filter @scriptcable/example-nuxt-app test` — nuxt build 산출물 단언 | drop-in 포함/원본 배제/wasm 산출 | "nuxt drop-in smoke OK — bundle uses the drop-in, calculator.wasm shipped", exit 0 (nuxt 4.6.2 첫 빌드에서 wasm 산출 — generateBundle emit 덕) | PASS |
| V-4 | `bun run --filter @scriptcable/example-remix-app test` — react-router build 산출물 단언 | 동일 | "react-router drop-in smoke OK — bundle uses the drop-in, calculator.wasm shipped", exit 0 (React Router 8.5, ssr:false SPA) | PASS |
| V-5 | `bun run --filter @scriptcable/example-solidstart-app test` — 실빌드 단언 또는 불가 실증 기록 | 성립 판정 + 증거 | 성립 — "solidstart drop-in smoke OK — bundle uses the drop-in, calculator.wasm shipped", exit 0 (@solidjs/start 2.0.6 + vite 8.3.5, 플러그인 무수정) | PASS |
| V-6 | 루트 `bun run test && bun run typecheck && bun run build` + 기존 예제 회귀 | 전부 exit 0 | 패키지 12종 build(12×exit 0)/test(0 fail)/typecheck exit 0; 기존 예제 8종(node/bun-start/vite/next/electron/astro/sveltekit/expo) 전부 exit 0; 신규 5종 최종 상태 재실행 전부 exit 0 | PASS |

## 구현 중 발견·해결한 사항 (계획 밖)

| 항목 | 내용 | 해결 |
|---|---|---|
| Deno flavor API 형태 | 계획 AC-1의 "named 함수 직접 import"는 번들러 drop-in의 재입이지 flavor API가 아님 — 모든 flavor는 `createClient()` 팩토리로 일관. CLI 런타임에 TLA 부작용 모듈은 과함 | AC-1 문구를 createClient 기준으로 갱신(위 표), main.ts도 createClient 패턴 |
| Deno .js 제약 재확인 | node_modules 하위 .ts 타입 제거 거부(조사 프로브와 동일) — deno를 RUNTIME_FLAVORS에 추가해 .js emit | client-package.ts RUNTIME_FLAVORS=['bun','node','deno'] |
| workerd 조건 실증 | wrangler 4.151 dry-run 프로브: exports first-match에서 WORKERD 마커만 번들에 포함 — 설계 확정 | 조건 'workerd', DOT_CONDITION_ORDER에서 browser보다 선행 |
| Nuxt vite root | Nuxt 4가 vite root를 srcDir(app/)로 설정 — config 탐색 실패("No core entry found … in <root>/app") | 플러그인: 명시적 `root` 옵션이 configResolved를 이기도 수정(rootExplicit) + 회귀 테스트 추가. nuxt.config에서 `scriptcable({ root })` 전달 |
| Nuxt public 스냅샷 순서 | Nuxt가 클라이언트 빌드 **전에** public/을 .output으로 스냅샷 — buildStart의 public 복사만으로는 첫 빌드에 wasm 누락 | 플러그인이 `generateBundle`로 wasm을 빌드 산출에 직접 emit(공개 복사본과 동일 파일명·동일 바이트) — 모든 Vite 임베드 호스트의 순서 문제 동시 해소 |
| SolidStart 2 vite peer | @solidjs/start 2.0.6 peer는 vite `^8 \|\| ^9`(rolldown 메인라인) — vite 7에선 rolldownOptions가 무시돼 ssr 환경 input이 index.html로 떨어져 빌드 실패 | 예제 vite를 ^8.3.5로; troubleshooting에 기록 |
| React Router 자동 의존 | `react-router build`가 누락된 `isbot` 의존을 자동 설치(RR 자동 복구 기능) — remix-app package.json에 추가된 것은 이 도구의 행위 | 수용(정상 동작에 필요) |
| wrangler wasm 파일명 | dry-run 산출의 wasm이 `<hash>-calculator.wasm`으로 emit | 스모크 단언을 임의 `.wasm` 파일 존재로 완화 |
| 테스트 환경 | zig PATH 미export 시 패키지 테스트가 zig 요구로 실패(기존 환경 함정 재확인) | 검증 명령에 PATH export 전제(문서화됨) |

## 평가자

- 구현 직접 수행(단일 세션) — 이전 라운드 관례. 설치는 공유 lockfile 영향으로 순차.
- **G3 코드 리뷰는 독립 평가자(하위 에이전트)** — 검증 재실행 대조. 결함은 아래 표에 기록.

## G3 리뷰 결함과 수정 (독립 평가자 초기 판정 FAIL → 수정 후 PASS)

독립 평가자가 검증 전체를 재실행(core 71 pass / vite 6 pass / deno·workers·nuxt·remix·solidstart·astro 전부 exit 0, workerd 조건 추가 프로브 포함)하고, 기능 결함 없이 위생 결함 1건(P2)과 P3 2건을 지적. 아래 표대로 수정 후 재검증을 통과해 **PASS로 재판정**.

| ID | 심각도 | 결함 | 수정 | 재검증 |
|---|---|---|---|---|
| F-1 | P2 | 신규 예제의 빌드·런타임 상태 파일(`.nuxt/`, `.output/`, `.wrangler/`, `.react-router/`)이 gitignore에 없음 — 커밋 시 Nuxt 산출물·wrangler sqlite가 유입될 위험 | 루트 .gitignore에 4패턴 추가(`.astro/`·`.svelte-kit/`와 같은 자리) | `git check-ignore` 4패턴 전부 IGNORED; `git status -uall examples/` 오염 0. 부효과: `public/calculator.wasm`이 `*.wasm` 무시로 CI 클린 체크아웃의 nuxt 빌드가 진짜 "첫 빌드" 검증이 됨 |
| F-2 | P3 | troubleshooting의 standalone Deno 안내 불완전 — `file:` 의존만으로는 `deno.js`가 bare import하는 `@scriptcable/core/wasm·/wasi` 해석이 안 됨(@scriptcable/core 미발행 — 기존 갭) | 같은 문단에 "core도 node_modules 트리에서 해석 가능해야 함" 명시 | 문서 검수 |
| F-3 | P3 | `wasmMethods()`가 genBrowserClient의 인라인 methods 블록과 중복 — 드리프트 위험 | browser도 wasmMethods 사용(생성물 바이트 동일) | core 71 pass / 0 fail(템플릿 단언 유지), vite 6 pass |

평가자가 확인 못 한 것(기록 유지): nuxt 첫 빌드의 generateBundle 기여 단독 분리 관측(로컬 warm public/ 재현 불가) — F-1로 CI 클린 체크아웃의 nuxt 스텝이 실증. 코드상 성립 논리(buildStart가 genDir에 wasm 기록 → 같은 빌드의 generateBundle이 읽어 emit)는 평가자가 소스로 확인.

## G4 사용성·디자인: N/A

UI 변경 없음(플러그인·codegen·예제·문서 변경뿐 — 예제 페이지는 기존 astro/sveltekit 패턴의 텍스트 표시뿐).

## G5 완료 (validate-plan completion — self-review, G3는 독립)

| AC | 판정 | 증거 |
|---|---|---|
| AC-1 Deno | PASS | V-1 — deno 2.9.6 실런타임 bare import + `deno run -A` → 42×2 + greet, 플래그·deno.json 0; deno flavor .js emit + `deno` 조건 `node` 선행(평가자 재실행·생성물 스팟체크 일치) |
| AC-2 Workers | PASS | V-2 — workerd 실런타임 HTTP 42 + dry-run 번들 단언(로더·flavor 포함/원본 배제/wasm emit); 평가자가 nodejs_compat 켠 경우까지 프로브해 workerd first-match 재확인 |
| AC-3 Nuxt | PASS | V-3 — nuxt 4.6.2 실빌드 첫 실행에서 drop-in·wasm 산출 단언 통과; rootExplicit 수정이 AC의 "플러그인 등록(+루트 1옵션)" 범위로 정직 문서화 |
| AC-4 React Router v8 | PASS | V-4 — RR 8.5 ssr:false SPA 실빌드 단언 통과 |
| AC-5 SolidStart 2 | PASS (성립) | V-5 — @solidjs/start 2.0.6 + vite 8.3.5 실빌드 단언 통과(플러그인 무수정); 불가 시나리오 미발동 |
| AC-6 회귀·문서 | PASS | V-6 — 패키지 12종 test(0 fail)·typecheck·build exit 0, 예제 13종 exit 0, README(영/한)·CHANGELOG·troubleshooting·CI 갱신, G3 overclaim 검토 통과, F-1~F-3 수정 후 재검증 통과 |

**잔여 한계**(계획 범위 밖·문서 표기): RN/Lynx 온디바이스 브리지(기기 없음), Turbopack/Rspack drop-in(아키텍처상 불가 실증 — conditions 경로는 동작), iOS/Android 네이티브 아카이브(사용자 환경), 코드젠 CLI의 Bun 전제(생성 클라이언트는 deno/workerd 런타임에서 Bun 불필요 — README 명시), standalone Deno 프로젝트의 `@scriptcable/core` 해석은 패키지 발행 전까지 워크스페이스/로컬 링크 전제(troubleshooting 명시), nuxt 첫빌드 emit의 단독 분리 관측은 CI 클린 체크아웃이 담당.
