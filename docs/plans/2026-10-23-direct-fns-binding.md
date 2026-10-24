# 2026-10-23 — per-export 직접 바인딩(fns): 호출 경계비용 축소

## 배경

2026-10-23 성능 실측(전체 보고는 대화 기록)에서 호출 경계의 대부분이 "경계"가 아니라 그 위의 JS 디스팟칭임을 확인:

| 경로 | ping | add | 비고 |
|---|---|---|---|
| 생성 클라이언트(N-API 애드온) | 31.3ns | 43.1ns | 현재 최우선 계층 |
| 범용 FFI `mod.call()` | 49.3ns | 51.0ns | 매 호출 `profile.exports.find()` + args 배열/spread |
| per-export 직접 FFI 심볼 (PoC) | **7.3ns** | **7.7ns** | 고정 시그니처 사전 바인딩 |

wasm 계층도 동일 구조(`byName.get` + switch 루프 + spread)로 54–78ns.

## 목표

앱 코드 변경 0(드롭인 유지)으로 클라이언트 호출 경계를 31–43ns → ~8–20ns 대역으로.

## 수락 조건

| ID | 조건 | 검증 |
|---|---|---|
| AC-1 | `NativeModule`·`LoadedModule`이 export별 사전 바인딩 `fns` 제공, 범용 `call()` 하위호환 유지 | V1, V4 |
| AC-2 | bun:ffi 계층: 수치 시그니처는 심볼 직접 호출, 문자열/bytes/cstring은 기존 `invokeNative` 래퍼 | V1 |
| AC-3 | wasm 계층: f64/f32 전용 시그니처는 직접 export 호출 | V1 |
| AC-4 | 생성 클라이언트(node/bun/browser/deno/workers/tauri)가 `fns` 사용 + Bun에선 공유 라이브러리 계층이 애드온보다 우선, Node는 기존 순서(애드온 먼저) 유지 | V1, V2 |
| AC-5 | 회귀 0: 루트 빌드·전체 테스트 통과, bench.ts/bench-gate(`call()` 소비자) 무수정 동작 | V1, V4 |
| AC-6 | 실측 개선 입증: 재생성 클라이언트 `client.add` ≤ 20ns 대역 및 기존 실측 대비 ≥2배, e2e 스모크 출력 동일 | V2, V3 |

## 태스크

| ID | 내용 | 선행 |
|---|---|---|
| T1 | native-loader: `fns` 추가(bun 직접 바인딩 + koffi 클로저 재사용), `call()` 유지 | — |
| T2 | wasm-loader: f64/f32 전용 직접 바인딩 `fns` 추가 | — |
| T3 | codegen: node/bun/browser/deno/workers/tauri 클라이언트가 `fns` 사용, `IS_BUN` 계층 순서, 애드온 함수 상수 고정 | T1, T2 |
| T4 | codegen 테스트 보강(생성물 문자열 단언) | T3 |
| T5 | 통합: 재빌드 → 전체 테스트 → e2e 스모크 → 벤치 재실측 비교 | T1–T4 |

## 가정·기각된 대안

- **가정**: Bun에서 .so 우선은 안전 — `isBun()` 런타임 체크, .so 부재 시 기존 폴백 체인(애드온→wasm) 그대로 작동. `addon:false`·`sharedPath`·`preferWasm` 옵션 의미 보존.
- **기각**: 계층 순서 유지 + 애드온만 속도화 — 직접 FFI 7.7ns 실측을 못 씀. / RN bridge 경로 변경 — RN은 브리지 JSON 직렬화가 지배, 범위 밖. / koffi(node) 직접 심볼화 — koffi func 시그니처 특성상 개선 폭이 작고 node 로컬 검증 불가(CI 몫).
- **한계(인정)**: 로컬에 node·deno 미설치 → node 런타임/deno 실측은 CI 몫. 문자열/bytes 마샬링 비용(alloc+copy)은 이번 범위 밖. 머신 부하로 절대값 변동 — 개선 판정은 동일 실행 상대비교로.

## 검증 계획

| ID | 방법 |
|---|---|
| V1 | `bun run build && bun run test` (루트, rc=0) |
| V2 | bench-core 재생성 후 계층별 실측 스크립트(이전 실측과 동일 방식) 재실행 |
| V3 | bun-app/node-app `start`, vite-app `test:ssr`·`test:wasm` 스모크 rc=0 + 출력 동일 |
| V4 | bench-core `bun src/bench.ts` + `bench-gate.ts` rc=0 (call() 호환) |

## G3 리뷰와 수정 (독립 리뷰어 1차 판정: FAIL → 수정 후 재판정: **PASS**)

- 재판정 근거: 리뷰어 자체 재실행 — 루트 빌드·테스트 rc=0(core 74·cli 5), 자체 제작 패리티 프루브(native 19케이스·wasm bool 3상태) 전부 통과, .so 은닉 프로젝트로 Bun 폴백 계층 실동작 확인, bench-core 재측정 client.add 6.1ns(AC-6 유지).
- N-1(P3, 반영): createClientSync JSDoc의 계층 설명 문장을 실제 순서대로 수정.
- N-2(정보): 리뷰 중 사용자 병행 편집(link-shared.ts android)이 잠시 dist를 깬 적 있음 — 정상 트리 재실행에서 전부 green. fns 작업과 무관.

| ID | 심각도 | 내용 | 처리 |
|---|---|---|---|
| F-1 | P1 | wasm 직접 경로가 bool 반환을 0/1 숫자로 반환(`hasDirectWasmSignature`가 bool 반환 허용, `makeDirectWasmFn` 무쉐이핑) — `as boolean` 캐스트만으로 1/0 누출 | 수정: `makeDirectWasmFn`에 bool 쉐이핑(callExport 패리티). cli 통합 테스트에 `--target wasm` + `preferWasm` 프루브 추가로 bool 패리티를 런타임에 고정 |
| F-2 | P2 | Bun에서 .so 부재 시 애드온 폴백 누락 — 계획 가정("폴백 체인 유지")이 코드에 미구현 | 수정: `createClientSync`/`createClient`에 `IS_BUN` 최후 폴백 계층 추가(공유 라이브러리 다음, throw/wasm 이전) — 가정을 문서 수정이 아니라 구현으로 해소 |
| F-3 | P3 | 신규 단언이 구조 문자열뿐 — 런타임 패리티 미고정, tauri/lynx 플레이버 미단언 | 보강: tauri/lynx `fns` 단언 + 위 F-1의 wasm 런타임 패리티 통합 테스트 |
| F-4 | P3 | node drop-in 주석이 계층 순서 변경 미반영. `IS_BUN` 표현식이 생성 클라이언트와 native-loader에 중복 | 주석 수정. 중복은 생성 코드의 독립성 유지 목적으로 수용 |
| F-5 | P3 | 작업 트리의 사용자 병행 편집(wire-android.mjs, Kotlin loadError 훙크) | fns 범위 외 — 리뷰에서 제외, 그대로 보존 |

## 검증 결과 (수정 후 최종 상태)

- V1: 루트 빌드 rc=0, 루트 테스트 rc=0 (cli 5 pass — wasm 패리티 통합 테스트 신규 통과, core 74 pass)
- V2: bench-core 재생성 후 clientSync ping 4.1ns / add 5.5ns, wasm add 5.9ns, 정합성(42·832040·문자열 왕복) 확인 — 개선 전 31.3/43.1ns(wasm 54–78ns) 대비 ~6–8배, generic call 48.7ns 동일 실행 대비 ~9배
- V3: bun-app 405ms·node-app 395ms·vite ssr+wasm 672ms 전부 rc=0 + 출력 동일 / astro·sveltekit 재빌드 rc=0 / RN app-bundle·lynx·tauri·dx·workers dry-run rc=0
- V4: bench.ts·bench-gate rc=0 (call() 소비자 무수정 호환)

## 잔여 한계

- node·deno 런타임이 로컬에 없어 애드온 계층(`__addon_x`)과 koffi 계층은 읽기 검증만 — 런타임 검증은 CI 몫.
- 성능 수치는 부하 있는 WSL2 머신 단일 실행 경향값 — 개선 판정은 동일 실행 상대비교 기준.
- wasm i64 반환은 callExport도 raw BigInt라 쉐이핑 불요(리뷰어 확인) — bool만 수정 대상이었음.
- linux-x64 bench-gate baseline은 미기록(별도 제안 과제).
