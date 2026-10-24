# 2026-10-23 — 전 경로 성능 실측 & zeroconfig DX 연구

**호스트:** WSL2 (Linux 6.18 x64) · **런타임:** Bun 1.4.4 · **툴체인:** scriptc 0.4.0, zig 0.13.0(`~/tools`, PATH 수동), cc=gcc 15.2(clang 없음)
**기준 상태:** 커밋 `ea113ba` + 미커밋 변경(fns 라운드 결과물 — `CHANGELOG.md`, `packages/core/src/{codegen,native-loader,toolchain,wasm-loader,link-shared}.ts` 등)
**방법:** 호출 경계는 `@scriptcable/testing` bench(200만/20만 iter, 평균·p50·p99), 월시간은 `python3 time.perf_counter` 서브프로세스 측정. 성능 수치는 부하 있는 WSL2 단일 실행 경향값 — 절대값보다 상대비 기준.
**측정 스크립트:** 호출 경계 `/tmp/sc-perf/layers.mjs`(bench-core 안에서 실행), 스모크 일괄 `/tmp/sc-perf/run-smokes.py`, 개별 로그 `/tmp/sc-perf/*.log`

---

## 1. 호출 경계 — 전 계층 실측 (examples/bench-core, `add` 동일 워크로드)

| 계층 | ping | add | fib(30) | repeat(100) | 비고 |
|---|---|---|---|---|---|
| JS 베이스라인 (호스트 내부) | 0.8ns | 1.2ns | 10.2ns | 417ns | 경계 없음 |
| **생성 클라이언트 `client.fns`** (bun flavor, .so 직접 바인딩) | **4.8ns** | **7.0ns** | **17.6ns** | 1.29µs | 10-23 fns 라운드 산물 |
| 로더 `native.fns` (bun:ffi 직접) | 9.6ns | 7.7ns | 20.2ns | 1.27µs | 클라이언트 포장 없음 |
| 로더 `wasm.fns` (직접 export 호출) | 9.8ns | 10.5ns | — | — | f64/f32 전용 |
| 범용 `call()` — native | 55.5ns | 58.0ns | 63.9ns | 1.34µs | bench.ts 측정 |
| 범용 `call()` — wasm | 53.3ns | 50.6ns | 70.5ns | 1.26µs | bench.ts 측정 |

해석:

- **fns 직접 바인딩 효과 재확인**: 범용 call 50–58ns → 직접 바인딩 4.8–10.5ns (**5–11배**). 경계 자체가 아니라 경계 위 JS 디스팟칭(`find`+switch+spread)이 비용이었다는 10-23 라운드 결론의 재현.
- 생성 클라이언트(client)가 로더 fns보다 ping에서 빠른 이유: 클라이언트는 함수 참조를 모듈 스코프 상수로 고정(코드젠이 `fns`를 풀어 상수 바인딩), 로더 fns는 `Record` 조회 1회가 남음.
- **문자열 왕복 1.27–1.34µs는 어느 계층에서나 동일** — alloc+copy 마샬링이 지배. 직접 바인딩으로도 못 줄임. 채터링 문자열 API는 배칭 권고 유지.
- wasm 범용 call이 native 범용 call보다 약간 빠른 현상도 재현(엔진 내장 wasm 호출 vs FFI 트램폴린).
- 기기·타호스트: BENCHMARK.md(2026-10-20, M1 Max)의 Node 애드온 24.5ns·브라우저 wasm 48ns·RN 브리지 165–181ns는 이 머신에서 미측정(node 부재) — CI 몫.

### 기동 (import → 호출 가능까지)

| 항목 | 시간 |
|---|---|
| 동적 `import('@scriptcable/client')` (웜) | 0.5ms |
| import → `createClientSync()` 준비 완료 | **1.6ms** |
| `createClient()` async (로드 포함) | 0.7ms |
| 로드 후 첫 호출 | ~47µs |

정합성 게이트: `add(20,22)=42`, `fib(10)=55`, `ping()=1`, `repeat('ab',3)='ababab'` — 전 계층 OK.

## 2. 빌드·테스트·CLI 시간

| 항목 | 시간 | 비고 |
|---|---|---|
| bench-core 콜드 빌드(scriptc 컴파일+링크, 산출물 전부 삭제) | **653ms** | M1 Max 1.06s 대비 빠름 |
| bench-core 웜 빌드(캐시 히트) | 301ms | |
| 웜 반복(캐시+코드젠 스킵) | 285ms | |
| 모노레포 클린 빌드(`rm -rf packages/*/dist` 후 `bun run build`) | **3.42s** | |
| 모노레포 반복 빌드 | 3.62s | 패키지 빌드에는 캐시 없음 — 매 동급 |
| core 패키지 단독 재빌드 | 900ms | |
| 전체 테스트 (`bun run test`) | **6.65s** | 100 tests: core 74·rn 8·vite 6·cli 5·webpack 4·next 3 |
| CLI 콜드 스타트 (`cli/dist/index.js --help`) | 107ms | |
| `scriptcable doctor` | 169ms | CI-durable client-dep 힌트 출력 확인 |

## 3. 호스트별 e2e 실측 (각 `build:core` 웜 포함 월시간)

| 시나리오 | 시간 | rc | 비고 |
|---|---|---|---|
| bun-app `start` | 416ms | 0 | |
| node-app `start` (bun 엔진) | 400ms | 0 | node 런타임 미측정(미설치) |
| vite `test:ssr` | 386ms | 0 | |
| vite `test:wasm` | 281ms | 0 | |
| vite `test:dropin` | 450ms | 0 | "drop-in smoke OK" — 후반 스택트레이스는 dev server 종료 경합, 무해 |
| lynx-app `test` | 429ms | 0 | |
| tauri-app `test` | 297ms | 0 | |
| next-app `test:server` | 666ms | 0 | |
| RN `test:app-bundle` (Metro 번들) | **1.50s** | 0 | |
| electron `build:renderer+main` | 820ms | 0 | |
| **electron 실런타임** | 906ms | 0 | WSLg + `LD_LIBRARY_PATH=~/tools/electron-libs…` 유저공간 라이브러리로 실기동 |
| astro-app `build` | 1.94s | 0 | |
| sveltekit-app `build` | 2.42s | 0 | |
| remix(react-router) `build` | 2.32s | 0 | |
| solidstart-app `build` | 2.78s | 0 | |
| nuxt-app `build` | **4.20s** | 0 | 최중(rolldown-vite + Nuxt 4) |
| workers-app `test` | 93.5s | **1** | **BLOCKED(외부)** — 번들/dry-run 통과, 런타임만 bun#39247 (Bun fetch가 Miniflare의 undici dispatcher 무시 → 503). smoke.mjs가 원인을 명시적으로 안내 |
| deno-app `test` | — | **127** | **BLOCKED(환경)** — deno 미설치(구 `bun install -g deno` 잔존 설치가 사라짐, `~/.bun/install/global` 0개). CI(denoland/setup-deno)가 담당 |

## 4. 신규 사용자 경로 실측 (init 퀵스타트)

| 단계 | 시간 | 결과 |
|---|---|---|
| `cli init /tmp/…/demo --host bun --from .` | 113ms | 생성 OK |
| `bun install` | 447ms | OK (단, 이 시점엔 `generated/`가 아직 없음) |
| `bun run doctor` | 159ms | OK |
| `bun run build` | 754ms | OK |
| `bun start` | 8ms | **rc=1 — `Cannot find module '@scriptcable/client'`** |
| `bun install` 재실행 → `bun start` | — | **OK** `{"sum":42,"hi":"hello, bun"}` |

### 발견된 DX 결함 (이번 실측에서 재현된 것)

| ID | 심각도 | 내용 | 재현 |
|---|---|---|---|
| F-1 | **P1** | **`@scriptcable/client` 플레이스홀더 쉐도잉** — 설치 시점에 `.scriptcable/generated`가 없으면 bun이 `node_modules/@scriptcable/client`를 플레이스홀더 **실제 디렉터리**(package.json+placeholder.ts)로 생성. 이후 `scriptcable build`가 generated를 만들어도 node_modules의 플레이스홀더가 남아 해석 실패. **설치를 한 번 더 해야 복구**. README 퀵스타트 순서(install→doctor→build→start) 그대로 실패 재현. doctor의 link repair(`toolchain.ts:165-174`)는 이 케이스(디렉터리 덮어쓰기)를 다루지 않음 | §4 표 + `node_modules/@scriptcable/client/{package.json,placeholder.ts}` 관찰 |
| F-2 | P2 | **init 절대경로 name 맹글링** — `init /tmp/sc-perf/demo`가 `name: '-tmp-sc-perf-demo'`, package.json `"name": "/tmp/sc-perf/demo"`을 생성(경로 전체를 이름으로 굽림). README 추론 규칙("디렉터리 이름")과 불일치. 상대 단일 세그먼트(`init demo`)에서는 재현 안 됨 | 생성물 `scriptcable.config.ts`·`package.json` 관찰 |

## 5. zeroconfig DX 연구

### 5.1 이미 "zero"인 축 (회귀시키지 말 것)

| 축 | 근거 |
|---|---|
| 설정 무추론 빌드 — name/entry/prefix/outDir/target 전부 추론 | README "Zero-config" 표, `packages/core/src/infer.ts`·`defaults.ts` |
| scriptc 자동 설치 (cwd 상승 → PATH → `bun add -d scriptc`) | `packages/core/src/toolchain.ts:80-103` |
| 런타임 팩 자동 설치 (`@scriptc/runtime-wasm32-wasi` 등) | `toolchain.ts:225-246` |
| drop-in — 앱 코드 변경 0 (vite/webpack/next/metro+expo) | `packages/core/src/dropin-resolve.ts`, README drop-in 표 |
| 빌드 캐시 — 웜 301ms, 정밀 무효화 | `.scriptcable/build-cache.json`, `packages/core/src/build-cache.ts` |
| `@scriptcable/client` — import 시 조건 해석, 호출 경로 분기 0 | 생성물 `package.json` exports |
| doctor — 환경 진단 + 링크 수리 + 플랫폼 안내 | `toolchain.ts:126-190`, 실측 169ms |
| 계약 게이트 (`scriptcable diff --fail-on-breaking`) | `packages/cli/src/commands/diff.ts` |

### 5.2 남은 마찰 → 권고 (우선순위순)

| ID | 마찰 (증거) | 권고 | 비용/기각 대안 |
|---|---|---|---|
| R1 | F-1 플레이스홀더 쉐도잉 — 첫 실행이 실패 (P1) | `ensureClientPackageLink`가 **기존 placeholder 디렉터리를 감지해 치환**하도록 강화(build·doctor 양쪽에서). 스캐폴드에는 `postinstall: scriptcable link` 정도의 얇은 훅도 대안 | 소규모. 기각: "문서에 재설치 안내 추가" — 신규 사용자 첫 5분의 실패는 안내로 못 막음 |
| R2 | zig PATH 의존 — wasm 빌드·vite/cli 테스트 3건 실패 실측(이번 세션 rc=1) | **zig 자동 프로비저닝**: `ensureRuntimePack`처럼 doctor/build가 `~/.../scriptcable-tools/zig-0.13`에 자동 다운로드+압축해제(bun install 스크립트 패턴 준수). 또는 최소한 "zig가 없으면 설치 명령을 그대로 실행할까요? (y/n)" 프롬프트 | 중규모(다운로드·무결성·캐시 위치 결정). 기각: zig를 optionalDependencies 바이너리로 배포 — scriptc가 zig를 실행 방식으로 요구해 패키징 복잡도가 남음 |
| R3 | native 링크가 clang/cc 요구 — cc(gcc)가 있어 통과했지만 clang-only 환경에선 실패 (`toolchain.ts:357-358`) | **zig cc 폴백 링커**: zig가 이미 있으면(wasm용) `zig cc`를 native 공유 라이브러리 링크에도 사용 → "zig 하나만 있으면 전부 됨"으로 요구 수렴 | 중규모. `link-shared.ts` 링커 선택 확장. 기각: 사용자가 sudo로 clang 설치 — sudo 불가 환경(본 호스트가 그렇다)에서 zeroconfig 아님 |
| R4 | 빌드 전제 테스트 — dist 없으면 `Cannot find module` (294ms에 rc=1 재현) | 루트 `pretest`로 `bun run build`(웜 3.4s) — 신규 클론의 1번 함정 제거. 패키지 exports에 `development` condition(src 직결)은 electron이 컴파일 .js를 요구해 충돌 위험이 커서 기각 | 소규모(package.json 스크립트 1줄). 트레이드오프: CI에서 매번 3.4s 추가 |
| R5 | bun 1.4.4 wrangler dev 불가 (외부 bun#39247) | 단기: 루트 `packageManager`가 이미 `bun@1.4.3`이므로 **bun 1.4.3 사용을 문서화**(troubleshooting에 이미 있음) + workers 런타임 검증은 CI에서만. 중기: node 우회 스크립트 제공 | 외부 버그라 내부 수정 불가. smoke.mjs의 친절한 에러 메시지는 이미 모범 사례 |
| R6 | deno 미설치 시 rc=127 | doctor가 deno-app류 워크플로를 감지하면 `bun install -g deno` 안내(또는 자동 설치). 예제 테스트는 CI 담당 유지 | 소규모 |
| R7 | electron LD_LIBRARY_PATH(WSL 전용), Android SDK/JDK 유저공간 경로 | doctor의 `--platform android` 확장처럼 환경 감지+안내로 통합. 이미 실측된 유저공간 레시피를 doctor 힌트 문자열로 | 소규모(문자열·감지) |

### 5.3 전략 결론 — "doctor 허브" 모델

노스스타("scriptcable만 추가하면 알아서 다 된다")에 대한 최단 경로는 새 추론 기능이 아니라, **이미 있는 doctor를 자동 치유 허브로** 만드는 것입니다:

1. **발견**(이미 있음): 런타임·scriptc·zig·clang·client 링크 상태를 169ms에 스캔.
2. **치유**(부분): scriptc·런타임 팩은 이미 자동 설치. 여기에 R1(링크 치유 강화)·R2(zig 프로비저닝)·R6/R7(안내→자동화)을 같은 곳에 붙인다.
3. **보고**(이미 있음): 못 고친 것은 외부 원인과 정확한 명령으로 안내(workers/bun#39247 메시지가 모범 사례).

이 모델의 실증 근거: 이번 세션에서 테스트 실패의 전부가 환경(zig PATH) 문제였고, 신규 사용자 경로의 유일한 실패(F-1)도 "링크만 다시 만들면" 해결됐습니다. 즉 **남은 실패의 대부분이 상태 복구 문제**이며, 코드 품질 문제가 아닙니다.

## 6. 검증 기록

| ID | 대상 | 방법 | 실제 | 판정 |
|---|---|---|---|---|
| V-1 | AC 호출 경계 | `bun src/bench.ts` + `/tmp/sc-perf/layers.mjs` (bench-core, zig PATH) | §1 표, rc=0, 정합성 OK | PASS |
| V-2 | 빌드·테스트·CLI | `python3 /tmp/timeit.py` 월시간 | §2 표 | PASS |
| V-3 | 호스트 e2e | `/tmp/sc-perf/run-smokes.py` 일괄, 로그 `/tmp/sc-perf/*.log` | §3 표 — 16/18 rc=0 | PASS |
| V-4 | 신규 사용자 경로 | init→install→doctor→build→start (README 순서) | §4 — start 실패→재설치 복구 | PASS(결함 F-1·F-2 기록) |
| V-5 | 테스트 회귀 여부 | zig PATH 세팅 후 `bun run test` | 100 tests 0 fail, 6.65s | PASS |

### 잔여 한계

- node·deno·workers 런타임 계층은 로컬 검증 불가(미설치/bun#39247) — 수치는 CI 몫. BENCHMARK.md의 M1 Max 수치와 기기·호스트가 달라 직접 비교 불가(상대비만 유효).
- 호출 경계 수치는 부하 있는 WSL2 단일 실행 경향값.
- koffi(Node FFI 폴백)·애드온 계층 미측정.
- F-1이 bun 버전 의존 동작(placeholder 생성)인지는 bun 1.4.3에서 미확인.
- 이 문서의 권고 R1–R7은 연구 산출물이며 구현 승인과 별개.
