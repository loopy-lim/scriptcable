# 플랫폼 커버리지 — Electron·Expo·웹 프레임워크·Rollup까지 "추가만 하면 된다"

- 날짜: 2026-10-22
- 기준 리비전: main @ 5f417ea (작업 트리 clean)
- 원 요청: "typescript를 사용하는 대부분의 프로젝트에서 이거 scriptable만 추가하면 알아서 모든것들이 잘 되는 수준" + "다양한 것들을 조사하고 모든 곳에서 지원" + "특히 모바일, 데스크탑 앱 부분에서와 웹부분을 위주로"
- 선행: [[auto-apply-dx-north-star]] 3차(drop-in)까지 완료 — Vite/Next(webpack)/Webpack/Metro 실호스트 검증済

## G0 intake (validate-plan intake 모드 — PASS)

**목표**: 검증 매트릭스(README 호스트 표)의 빈 곳 — 데스크톱(Electron 미검증 `—`), 모바일(Expo 언급만), 웹(Vite 기반 프레임워크·Rollup 미확인) — 을 실검증으로 메워 "플러그인 등록만 하면 된다"가 그 환경에서도 참이 되게 한다.

**관찰 가능한 AC로 전환한 결과**: 아래 수락 기준 표. 막힌 결정 없음.

**범위 밖 (기존 한계 유지, 이번 라운드에서 새로 만들지 않음)**:
- iOS/Android 실기기 네이티브 빌드(Xcode/NDK 아카이브 링크) — 이 환경에 툴체인·기기 없음. 기존 문서 레시피 유지.
- Electron 패키징(electron-builder/forge 배포) — 런타임 동작 검증이 범위. 배포 파이프라인은 별도.
- Turbopack/Rspack drop-in — 아키텍처상 불가가 이미 실증·문서화됨(conditions 경로 제공). 재시도 아님.
- Deno/Cloudflare Workers 지원 — 코어 CLI가 Bun 기반, WASM-only 호스트는 별도 로더 필요. README 한계 표기만.

## 현재 구조와 근거 (조사 완료, 2026-10-22)

| 위치 | 현재 동작 |
|---|---|
| `README.md:109` 호스트 표 | Electron 행의 Verified 칸이 `—` — 레시피(`README.md:251-259`)만 있고 실제 Electron 런타임 검증 없음 |
| `README.md:287` | Expo는 "your Expo module (Xcode / NDK CMake)" 언급만 — Expo의 metro 번들러 위 drop-in 검증 없음 |
| `examples/react-native-app/scripts/metro-bundle.mjs` | 실제 Metro 0.87 번들 스모크 패턴 — `getDefaultConfig` + `withScriptcableMetro` + `Metro.runBuild` 후 번들 문자열 단언 (drop-in 코드 포함/원본 TS 소스 배제). Expo는 `@expo/metro-config`로 동일 패턴 재현 가능 |
| `packages/vite/src/index.ts` | 플러그인 훅: `configResolved`(vite 전용, rollup에 없음), `buildStart`, `resolveId` 객체형(`order:'pre'` — rollup 표준 지원), `handleHotUpdate`(vite 전용). rollup에서 configResolved 미호출 → `publicDir=''` 초기값 → wasm 복사 경로 미정. `this.resolve`는 rollup 표준. 즉 rollup 호환은 대체로 성립하나 **빌드 게이트가 serve 기정사실**로 통과되고 publicDir 폴백 필요 |
| `examples/vite-app` | 플러그인 스모크 예제 패턴: `test:*` 스크립트 + src/*.ts 스모크 |
| `examples/calculator-core` | 모든 예제가 재사용하는 공유 코어 — `build --hosts node,bun,browser,tauri,react-native,lynx` |
| `.github/workflows/ci.yml` | ubuntu/macos 매트릭스 + windows 잡. 예제 테스트를 filter로 명시 나열 — 신규 예제도 여기에 추가 |
| 환경 | Bun 1.4.3, Node v24.22.1, WSLg X 서버 `DISPLAY=:0` 확인(xvfb 불필요, 로컬에서 Electron GUI 실행 가능), npm registry 접근 정공. CI ubuntu-latest는 xvfb-run 사전 설치됨 |

**확인된 검증 명령** (루트): `bun run test` / `typecheck` / `build`, 예제별 `bun run --filter '<name>' test`. CI 정의: `.github/workflows/ci.yml`.

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | `examples/electron-app`에서 (a) 실제 Electron 런타임의 main 프로세스가 `@scriptcable/client`(node conditions)로 네이티브 코어를 호출해 `add(20,22)===42`를 얻는다 (b) renderer(vite 빌드)가 drop-in 브라우저 클라이언트로 WASM 코어를 호출해 동일 결과를 얻는다. README 호스트 표의 `—`가 실측으로 대체된다 | T-1 | V-1 |
| AC-2 | Expo의 실제 metro 기본 설정(`@expo/metro-config`의 `getDefaultConfig`) 위에서 `withScriptcableMetro`가 엔트리 import를 RN drop-in으로 리다이렉트한 번들을 만든다 — 번들에 drop-in 브리지 코드 포함, 원본 TS 엔트리 소스 배제. README에 Expo 레시피가 있다 | T-2 | V-2 |
| AC-3 | Vite 기반 프레임워크에서 drop-in이 동작한다 — Astro는 실제 `astro build` 산출물로 검증(번들에 drop-in 클라이언트 포함, 원본 엔트리 소스 배제, WASM 정적 산출 포함). SvelteKit/Nuxt/Remix(React Router)/SolidStart는 조사 기반 레시피로 README에 기재 | T-3 | V-3 |
| AC-4 | `@scriptcable/vite` 플러그인의 Rollup 호환이 확인된다 — 실제 rollup 빌드에서 엔트리 import가 drop-in으로 리다이렉트된다(필요한 최소 수정: publicDir·게이트 폴백). 불가한 부분은 이유와 함께 문서화 | T-4 | V-4 |
| AC-5 | 회귀 없음 — 전 패키지 test/typecheck/build 통과, 기존 예제(vite/next/lynx/rn/node/bun) 회귀 통과, CHANGELOG 갱신, 신규 예제 검증이 CI에 연결됨 | T-5 | V-5 |

## 설계

**T-1 Electron (`examples/electron-app`)**
- 구성: `main.ts`(Electron main — `createClient()` node conditions → 네이티브), `renderer/`(vite 빌드 — `import { add } from '../calculator-core/src/core'` → vite 플러그인 drop-in), `electron.vite` 대신 순수 electron+vite로 최소 의존.
- renderer 서빙: `protocol.handle('scriptcable', …)`로 dist 서빙(커스텀 프로토콜이 Electron 권장 방식) — file:// fetch CORS 회피. 브라우저 클라이언트의 `compileStreaming` 폴백(CHANGELOG 확인됨)이 mime 불일치를 흡수.
- main 프로세스 검증 포인트: Electron의 Node ABI에서 N-API 애드온(`{name}.node`) 로드 — N-API는 ABI 안정이라 호환 기대, 실패 시 공유 라이브러리 FFI 폴백. 이 동선 자체가 검증 내용.
- 헤드리스 CI: `xvfb-run -a` (ubuntu CI), 로컬은 WSLg DISPLAY=:0.
- 단언: main `add(20,22)===42` + renderer 결과를 `ipcMain.handle`/executeJavaScript로 회수 → 프로세스 exit code.

**T-2 Expo (`examples/react-native-app/scripts/expo-bundle.mjs`)**
- `@expo/metro-config`의 `getDefaultConfig`로 Expo의 진짜 기본 설정을 얻어 `withScriptcableMetro` 적용 → `Metro.runBuild` → 기존 metro-bundle.mjs와 동일 단언(drop-in 브리지 포함, 원본 TS 소스 배제).
- expo SDK 전체 설치는 의존성 대비 검증 증분이 없어 `@expo/metro-config`만 설치(Expo 프로젝트의 metro 계층 = 이 설정).

**T-3 Astro (`examples/astro-app`)**
- `astro.config.mjs`의 `vite: { plugins: [scriptcable()] }` — Astro는 Vite 위이므로 플러그인 무수정 기대. `astro build` 후 dist 산출물 단언: drop-in 클라이언트 참조 포함, calculator-core 원본 소스 문자열 배제, `<name>.wasm` 정적 산출 포함.
- SvelteKit/Nuxt/Remix/SolidStart: 각각 Vite 위 → 동일 플러그인 삽입 지점 문서화(조사 기반, 설치 검증은 범위 밖 표기).

**T-4 Rollup**
- 스모크: rollup으로 node 번들 빌드(`@scriptcable/vite` 플러그인 재사용) → 번들에 drop-in(node flavor는 옵션 과제 — vite 플러그인 drop-in은 browser 고정이므로 rollup용 flavor 옵션 추가 검토: `dropin: 'browser' | 'node'`).
- 최소 수정: `configResolved` 미호출(rollup) 시 `publicDir` 폴백(root/public)과 build 게이트 기본값 정리. rollup은 브라우저 target 미지정이므로 TLA 게이트를 rollup 컨텍스트에서 강제하지 않도록.

**T-5 문서·CI·회귀**
- README.md/ko: 호스트 표 갱신(Electron 실측, Expo 행 추가, Astro/프레임워크 행, Rollup), 각 절 레시피, 미지원 표기(Deno/Workers).
- CI: electron(linux, xvfb-run)/expo/astro/rollup 스모크 추가 — 설치 비용 있는 것은 캐시·타임아웃 고려.
- CHANGELOG Unreleased 갱신.

## 오류·경계

- Electron 애드온 ABI 불일치 가능성 → 생성 클라이언트는 애드온 실패 시 공유 라이브러리 폴백(기존 로직) — 어느 경로로 42가 나왔는지 검증 출력에 남김.
- Astro SSG는 Node에서 렌더(서버 번들) + 브라우저 번들 양쪽 생성 — drop-in은 브라우저 그래프에서만 리다이렉트 기대. 서버 그래프가 엔트리를 가져가는 경우 node drop-in 필요성 관찰 후 대응.
- rollup에서 `resolveId`의 `this.resolve` 재귀 — `skipSelf: true` 이미 사용(vite와 동일 표준).
- expo 설정의 `watchFolders`/캐시 차이로 스모크 실패 시: expo 설정을 실제 expo 앱 구조로 최소 재현.

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 ID |
|---|---|---|---|---|
| T-1 | Electron 예제 + 실런타임 검증 (AC-1) | 신규 `examples/electron-app/*`, `README.md` 표 | 없음 | V-1 |
| T-2 | Expo metro 실설정 스모크 (AC-2) | `examples/react-native-app`(스크립트·의존성), `README.md` | 없음 | V-2 |
| T-3 | Astro 실빌드 스모크 + 프레임워크 레시피 (AC-3) | 신규 `examples/astro-app/*`, `README.md` | 없음 | V-3 |
| T-4 | Rollup 호환 확인·최소 수정 (AC-4) | `packages/vite/src/index.ts`(+테스트) | 없음 | V-4 |
| T-5 | 문서·CI·회귀 (AC-5) | `README.md`, `README.ko.md`, `CHANGELOG.md`, `.github/workflows/ci.yml` | T-1~T-4 | V-5 |

## 검증 계획과 결과

| ID | 방법 | 기대 | 실제 결과 | 판정 |
|---|---|---|---|---|
| V-1 | `bun run --filter @scriptcable/example-electron-app start` (xvfb-run 폴백, WSLg DISPLAY=:0) — 실제 electron 실행 | exit 0, main+renderer 42 | electron main add(20,22): 42 OK / greet 42 OK, renderer add(20,22): 42 OK, "electron smoke OK", exit 0 (Electron 33, 실제 Electron Node 런타임에서 N-API 애드온 로드 포함) | PASS |
| V-2 | `bun run --filter @scriptcable/example-react-native-app test:expo` — Expo 58 `getDefaultConfig` 위 withScriptcableMetro + Metro.runBuild 단언 | 번들에 브리지 포함/원본 소스 배제 | "expo drop-in smoke OK — bundle includes the RN drop-in bridge, 2248946 bytes", exit 0 (스크립트 전체: build:core → build:hosts → 번들 단언) | PASS |
| V-3 | `bun run --filter @scriptcable/example-astro-app test` — astro build 산출물 단언 (profile_format 포함/원본 소스 배제/wasm 산출 — minify-safe 문자열) | drop-in·wasm 포함, 원본 배제 | "astro drop-in smoke OK — bundle uses the drop-in, calculator.wasm shipped" (Astro 5.18 실빌드) | PASS |
| V-4 | `bun run --filter @scriptcable/vite test` — rollup.test.ts (실제 rollup() 빌드 2건) | 리다이렉트 성립, dropin:false 원본 유지 | 5 pass / 0 fail (plugin.test 3 + rollup.test 2 — drop-in-only export import로 트리셰이크 방지 단언) | PASS |
| V-5 | `bun run test && bun run typecheck && bun run build` + 기존 예제 회귀 | 전부 성공 | 전 패키지 test/typecheck/build exit 0 (fail 0); vite-app 4단계·next-app(node drop-in 런타임)·node-app·bun-app 전부 exit 0 | PASS |

## 구현 중 발견·해결한 저장소 결함/환경 이슈 (계획 밖)

| 항목 | 내용 | 해결 |
|---|---|---|
| Electron .ts 로드 | Electron의 Node 20은 ESM `.ts`를 로드 불가 — `@scriptcable/client`의 node conditions가 `.ts`를 직접 가리켜 main이 즉시 실패(ERR_UNKNOWN_FILE_EXTENSION) | `writeGeneratedClients`가 bun/node 플레이버의 `.js`를 `transpileModule`로 함께 emit하고 manifest conditions을 `.js`로 전환(브라우저/RN/lynx/tauri와 drop-in은 번들러가 TS 처리하므로 `.ts` 유지) — client-package.test.ts 갱신+케이스 추가 |
| Linux 링크 게이트 불일치 | toolchain 게이트는 clang만 요구하는데 실제 링커(`linkSharedLibrary`)는 `clang ?? cc` 허용 — cc-only 머신에서 게이트가 링커보다 엄격(버그) | 게이트를 clang-or-cc로 완화, ToolchainInfo에 hasCc/ccPath 추가, 힌트 갱신 |
| bun 1.4 isolated linker | bun 1.4 기본 linker가 isolated로 바뀌며 워크스페이스 해석 전반이 깨짐(재현: 모든 패키지 import 실패) | `bunfig.toml`에 `linker = "hoisted"` 고정 + 전면 재설치 |
| rollup 확장자 없는 상대 import | rollup 기본 해석기는 './core' 확장자 생략을 해석하지 않음(node-resolve 역할) | 테스트 보조 플러그인에 .ts 매핑 제공 + 문서화("TS 변환과 형제 해석은 호스트 몫") |
| expo 의존 정합 | @expo/metro-config 54 hoist vs expo 58 — RN 0.88 Flow 문법 파싱 실패 | @expo/metro-config를 58로 매칭; expo 스모크에 getPolyfills 오버라이드(리졸버 스모크에 폴리필 불필요) |
| Electron 실행 환경(WSL2) | 시스템 libnss3/libasound 부재, sudo 불가 | apt-get download + dpkg -x 유저공간 설치 + LD_LIBRARY_PATH(로컬 한정, CI ubuntu는 사전 설치) |

## 평가자

- 구현은 직접 수행(단일 세션), 설치 단계는 공유 lockfile 때문에 순차 진행.
- G3 코드 리뷰는 독립 평가자(하위 에이전트)가 수행 — 검증을 전부 재실행해 대조. **판정: PASS**(AC-1~5 전부 충족), P3 결함 4건 지적 → 아래 표대로 수정 후 영향 검증 재실행.

## G3 리뷰 결함과 수정 (독립 평가자 PASS + P3 4건)

| ID | 심각도 | 결함 | 수정 | 재검증 |
|---|---|---|---|---|
| F-1 | P3 | `doctor`가 cc-only Linux에서 clang MISSING으로 exit 1 — 링크 게이트 완화와 동일 클래스 불일치 | doctor도 clang-or-cc 보고(`linker:` 라인, hasCc/ccPath 사용) | cli 테스트 4 pass; 실 doctor 출력 `linker: /usr/bin/cc ✓ (gcc cc)` (cc-only 이 머신이 정확히 해당 케이스) |
| F-2 | P3 | README 퀵스타트 요구 문구가 `clang` 단독 — ko·제한 절과 불일치 | README.md 퀵스타트 "clang (or gcc's cc)"로 갱신(ko는 이미 반영) | 문서 검수 |
| F-3 | P3 | electron main의 greet 검사 결과가 폐기됨 — OK 표기가 단언처럼 오해될 수 있음 | greet를 mainOk 게이트에 포함(별도 로그 라인 유지) | electron E2E 재실행 — "main greet: OK", add 42×2, smoke OK, exit 0 |
| F-4 | P3 | protocol.handle에 404 처리 부재 — drop-in의 URL 프로브(dist/assets/calculator.wasm)마다 ENOENT 스택 | readFile 실패 시 404 Response 반환 | electron E2E 재실행 — ENOENT 스택 미관찰, smoke OK |

참고(리뷰어 지적 보완): expo 풀 패키지 devDep는 계획의 "@expo/metro-config만 설치"와 다르나, @expo/metro-config@58이 peerDependencies로 expo를 요구해 필요 — 위 "구현 중 발견" 표의 expo 의존 정합 항목과 함께 읽을 것.

## G5 후 웹 커버리지 보강 — SvelteKit 실검증 (2026-10-22)

- **AC-3 확장**: SvelteKit을 레시피-only에서 실빌드 검증으로 상향. `examples/sveltekit-app` — adapter-static + `export const ssr = false`(client-only 페이지, 클라이언트 그래프가 drop-in 서비스 대상), `sveltekit()` 옆에 `@scriptcable/vite` 등록.
- 검증: `bun run --filter @scriptcable/example-sveltekit-app test` → 실제 `vite build`(sveltekit()) + 어댑터 산출(build/) 단언 — "sveltekit drop-in smoke OK — bundle uses the drop-in, calculator.wasm shipped". **플러그인 코드 무수정** — Astro와 동일하게 표준 resolveId 훅으로 성립.
- 문서·CI: README(영/한) 호스트 표·어댑터 절, CHANGELOG, ci.yml에 SvelteKit 스텝 추가.
- Nuxt/Remix/SolidStart는 레시피 유지(같은 Vite 훅 경로 — 두 프레임워크에서 무수정 실증됨).

## G5 완료 (validate-plan completion — self-review, G3는 독립)

| AC | 판정 | 증거 |
|---|---|---|
| AC-1 Electron | PASS | V-1 (F-3·F-4 수정 후 재검증 포함) — 실 Electron 33 런타임 main 네이티브 + renderer drop-in 42×2, README 표 `—` 실측 대체 |
| AC-2 Expo | PASS | V-2 — Expo 58 실 metro 설정 번들(브리지 포함/원본 배제), README(영/한) 레시피 |
| AC-3 웹 프레임워크 | PASS | V-3 — Astro 5.18 실빌드(drop-in+wasm, 원본 배제), **SvelteKit 2 실빌드도 추가 검증**(examples/sveltekit-app — adapter-static + ssr=false, "sveltekit drop-in smoke OK", 플러그인 무수정), Nuxt/Remix/SolidStart 레시피 README 기재 |
| AC-4 Rollup | PASS | V-4 — rollup 4 실빌드 리다이렉트 2건(redirect + dropin:false 대조), 한계(TS 변환 호스트 몫) 문서화 |
| AC-5 회귀·문서·CI | PASS | V-5 — 전 패키지 test/typecheck/build 0 fail, 예제 7종 exit 0, README/ko·CHANGELOG·CI 갱신, G3 재실행으로 이중 확인 |

**G4 사용성·디자인: N/A** — UI 변경 없음(예제·플러그인·문서 변경뿐).

**잔여 한계**(계획 범위 밖, 문서 표기 유지): iOS/Android 실기기 브리지 호출, Turbopack/Rspack drop-in(아키텍처상 불가 — conditions 경로), Deno/Workers, Windows에서의 신규 예제 검증(호스트 없음 — CI windows 잡은 기존 core/cli 범위 유지).
