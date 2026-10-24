# 2026-10-23 — zeroconfig DX 라운드 (연구 R1–R7 구현)

## 배경

`docs/research/2026-10-23-performance-and-zeroconfig-dx.md`에서 실측·도출한 마찰 7건을 해소한다. 노스스타는 "scriptcable만 추가하면 알아서 다 된다"이며, 전략은 **doctor/build를 자동 치유 허브로** 확장하는 것. 연구에서 재현된 결함: F-1(P1) client 플레이스홀더 쉐도잉, F-2(P2) init 절대경로 name 맹글링.

## 수락 조건

| ID | 조건 | 검증 |
|---|---|---|
| AC-1 | `@scriptcable/client`가 package.json에 `file:.scriptcable/generated`로 선언돼 있으면, node_modules의 bun 관리 사본(실제 디렉터리)도 build/doctor가 치유한다(재설치 불요). 미선언 실제 디렉터리는 기존 정책대로 불간섭 | V1, V4 |
| AC-2 | PATH에 zig이 없어도 wasm·android 빌드가 캐시된 zig(`SCRIPTCABLE_CACHE_DIR`/XDG 캐시)로 성공하고, 캐시가 없으면 1회 자동 다운로드(0.13.x). `SCRIPTCABLE_NO_AUTO_TOOLS=1`로 옵트아웃 — 기존 수동 안내로 폴백 | V2, V5 |
| AC-3 | clang·cc가 없어도 zig만 있으면 host 공유 라이브러리 링크(`zig cc`)와 정적 아카이브 병합(`zig cc`+`zig ar`)이 성공하고, 생성 .so가 실제 로드·호출된다 | V3 |
| AC-4 | 신규 클론 상태(dist 없음)에서 `bun run test`가 pretest 빌드로 통과한다 | V4 |
| AC-5 | doctor가 deno 부재·WSL 환경을 감지해 안내를 출력하고, zig 자동 설치 예정 사실을 보고한다 | V6 |
| AC-6 | troubleshooting에 workers-on-bun(39247)·zig 자동 설치·WSL electron 항목이 있고 README 요구사항·CHANGELOG가 반영된다 | V7 |
| AC-7 | 회귀 0: 루트 빌드·전체 테스트·핵심 e2e(bun-app/vite/next) 통과 | V8 |

## 태스크

| ID | 내용 | 선행 |
|---|---|---|
| T1 | client-package: `ensureClientPackageLink`가 **선언된 file: 의존의 관리 사본**(실제 디렉터리)을 rm+symlink로 치유('repaired'). 미선언은 기존 'blocked' 유지. 테스트 추가 | — |
| T2 | core 신규 `zig-tools.ts`: 캐시 루트·URL 매핑·findZig(PATH→캐시)·ensureZig(다운로드+추출+버전 검증). doctor는 캐시까지만 조회(다운로드 없음), buildCore의 wasm/android 분기에서 자동 확보+scriptc 하위프로세스 PATH 주입 | — |
| T3 | link-shared: `zigPath`·`preferZigLink` 옵션 — host 링커 폴백 zig cc, `buildCompleteStaticArchive`도 zig cc/zig ar 폴백. buildCore 게이트·전달 갱신 | T2 |
| T4 | 루트 package.json `pretest: bun run build` | — |
| T5 | doctor: ToolchainInfo에 deno 감지 추가, CLI 출력에 deno 줄·zig 자동설치 안내·linker-zig 폴백 표기·WSL electron 힌트 | T2 |
| T6 | 문서: README 요구사항·troubleshooting 3항목·CHANGELOG | T1–T5 |
| T7 | 통합: 빌드→전체 테스트→실측 검증 V1–V8 | T1–T6 |

## 가정·기각된 대안

- **bun file: 의존은 node_modules에 실제 디렉터리 카피** (예제들·데모 관찰, symlink 아님). 판별자는 "package.json 선언" — placeholder 마커 파일 대신 원칙적 기준. 미선언 디렉터리는 사용자 소유로 간주해 불간섭 유지(기존 정책 존중).
- **치유는 symlink로**: 단일 진실원천(genDir) 유지. 재설치 시 bun이 카피로 되돌려도 내용이 현재라 무해 — bench-core 등 예제의 기존 symlink 관례와 동일.
- **zig 다운로드는 빌드 시점 1회**: doctor(169ms 패스트패스)는 다운로드하지 않는다. esbuild류 설치 시 바이너리 패턴 대신 런타임 프로비저닝을 택한 이유: scriptc는 zig을 PATH 실행으로 요구해 패키징 복잡도가 큼. 옵트아웃 env로 CI 결정성 확보.
- **기각**: zig를 optionalDependencies로 배포(플랫폼 매트릭스·scriptc 실행 방식과 불일치) / deno 자동 설치(전역 설치가 사라진 관측 — 부재 감지+안내만) / electron 라이브러리 자동 설치(배포판별 복잡도 — 힌트 문자열만) / `development` condition으로 dist 의존 제거(Electron의 .js 요구와 충돌).
- **F-2(init 절대경로 name 맹글링)는 이번 라운드 제외**: 마찰이나 회귀를 유발하지 않는 스캐폴드 품질 문제이며, init 템플릿 변경은 T6 문서의 후속 제안으로만 남긴다. (범위 통제 — 요청 "모두 개선"은 연구 권고 R1–R7 기준.)
- **한계(인정)**: node·deno·workers 런타임 검증은 이 호스트에서 불가(CI 몫). zig 다운로드 실측은 이 세션 1회(네트워크 의존).

## 검증 계획

| ID | 방법 |
|---|---|
| V1 | 단위: client-package.test에 관리 사본 치유·미선언 불간섭 케이스 추가, rc=0 |
| V2 | 실측: 캐시 비움+PATH에서 zig 제거 → wasm 빌드(다운로드 발생→성공). 이후 캐시 히트 재빌드. `SCRIPTCABLE_NO_AUTO_TOOLS=1`에서 기존 에러 메시지 확인 |
| V3 | 실측: bench 아카이브를 `preferZigLink`로 링크 → loadNativeFromOutDir 로드 → add/ping 패리티 |
| V4 | 실측: `rm -rf packages/*/dist` → `bun run test` rc=0(pretest 발동 로그 확인) + 데모 재현(관리 사본 수동 주입→build→start 성공) |
| V5 | 단위: URL 매핑·캐시 경로 테스트 |
| V6 | 실측: doctor 출력에 deno·WSL·zig 안내 줄 확인 |
| V7 | 존재 확인: troubleshooting 3항목, README, CHANGELOG |
| V8 | `bun run build && bun run test` rc=0 + bun-app/vite/next 스모크 rc=0 |

## 검증 결과

- V1: client-package 치유 단위 테스트 2건 신규 포함 `bun test packages/core` rc=0 — 관리 사본 치유('repaired'+symlink 검증)·타깃 불일치 선언은 'blocked' 유지 확인
- V2: 실측 — zig PATH 밖 + 빈 캐시(`SCRIPTCABLE_CACHE_DIR=/tmp/sc-zigcache`)에서 dx-app `build --target wasm`이 자동 다운로드 후 성공(11.3s), 캐시 히트 재빌드 275ms, `--force` 재컴파일도 캐시 zig(PATH 밖)으로 rc=0 359ms, `SCRIPTCABLE_NO_AUTO_TOOLS=1`+`--force`+빈 캐시는 갱신된 힌트의 `ScriptcableToolchainError`(rc=1) 확인
- V3: 실측 — bench 아카이브를 (a) `preferZigLink` 강제 (b) PATH에서 cc 제거+zigPath 제공 두 경로로 `zig cc` 링크, 생성 .so를 `bun:ffi` dlopen해 `bench_add(20,22)=42` 실호출 확인
- V4: `rm -rf packages/*/dist` 후 `bun run test` rc=0(10.6s — pretest 빌드 발동); 데모(/tmp/sc-perf/demo)에서 플레이스홀더 관리 카피 재주입 → build(rc=0) → 재설치 없이 `bun start` 성공(`{"sum":42,...}`), node_modules 링크가 symlink로 치유됨 관찰
- V5: zig-tools 단위 테스트 3건 rc=0 — URL 매핑(linux/macos/windows·x64/arm64), `SCRIPTCABLE_CACHE_DIR` 오버라이드, findZig 무다운로드
- V6: doctor 출력에 deno 라인 + `WSL (detected via /proc)` 힌트 실관측(이 셸은 `WSL_DISTRO_NAME` 부재 — /proc 폴백이 실제로 발동하는 것으로 검증)
- V7: troubleshooting 3항목(bun#39247·zig 자동 프로비저닝·WSL Electron), README 요구사항, CHANGELOG Added 블록 확인
- V8: `bun run build` rc=0(3.9s), 전체 `bun run test` rc=0(10.2s) — **105 tests, 0 fail**(core 79/11 = 기존 74 + client-package 2 + zig-tools 3), bun-app 410ms·vite ssr+wasm+dropin 1.1s·next server 625ms 스모크 rc=0

측정 유의: 초기 전체 테스트 로그(core 74 표기)는 캡처 파이프라인 버그(timeit 꼬리 잘림 + 이전 셸 로그 잔존)로 낡은 값이었고, 잘림 없는 재캡처로 79/11·0 fail 확정 — bun 자체에는 문제 없음.

## G3 리뷰와 수정 (독립 리뷰어 판정: **PASS** — P0/P1 없음, 리뷰어 자체 재실행 포함 / 결함 7건 수정 후 재검증)

리뷰어 자체 재실행: 빌드 rc=0, core 79 pass, 루트 테스트 2회 전 fail=0(pretest 발동 관측), `zig ar x/rcs`·`zig cc` 실동작, `env -i` PATH에서 buildCompleteStaticArchive+linkSharedLibrary(preferZigLink) zig 경로 end-to-end(STATIC_OK/SHARED_OK), zig-linked .so dlopen 42, dx-app wasm 캐시 히트 빌드, doctor 출력 — 리뷰어가 작성자 증거에 없던 AC-3 정적 아카이브 경로와 AC-4/5를 독립 보강 검증.

| ID | 심각도 | 내용 | 처리 |
|---|---|---|---|
| F-1 | P2 | native 게이트가 방금 프로비저닝한 buildZig을 무시 — `--target both`에서 wasm arm 성공 직후 native arm이 "zig required"로 실패 가능 | 수정: 게이트에 `&& !buildZig`. **실측 재현 완료**: 빈 캐시+clang/cc 없는 PATH에서 `--target both --force` rc=0(10.3s, zig 다운로드→wasm+native+정적 아카이브 전부 생성, addon은 정상 soft-skip), zig cc 링크 .so dlopen `dxapp_add(20,22)=42` |
| F-2 | P2 | ensureZig가 fetch **거부**(오프라인·DNS)를 처리하지 않아 raw throw — 문서 약속(수동 설치 힌트) 위반 | 수정: try/catch → log+undefined. **실측**: patched-fetch 프로브에서 LOG+undefined, throw 없음 |
| F-3 | P3 | findCachedZig이 부정 결과를 프로세스 수명 동안 메모 — 장수 프로세스(watch/플러그인)에서 설치 후에도 캐시 미인지 | 수정: 설치 성공 후 `cachedZigPath` 재설정(코드 검증 — 리뷰어의 MEMO_STALE 재현 시나리오의 in-process 설치 경로 차단) |
| F-4 | P3 | 다운로드에 타임아웃·임시 dir 청소 부재 | 수정: `AbortSignal.timeout(120_000)` + 추출 블록 try/finally로 `.zig-download-<pid>` 잔존 제거(코드 검증) |
| F-5 | P3 | 미지원 arch(ia32·arm 등)가 존재하지 않는 타르볼 URL로 404 | 수정: ensureZig 선행 가드로 명시적 안내 후 undefined(코드 검증) |
| F-6 | P3 | buildCompleteStaticArchive가 bash -c 문자열 보간(SCRIPTCABLE_CACHE_DIR의 셸 특수문자 위험) | 수정: argv 배열 호출(run에 cwd 추가)+redict objs 나열. **실측**: F-1 경로에서 `zig ar x/rcs` 실동작 — 1차 수정에서 zig 분기의 `'ar'` 하위명령 누락("unknown command: x")을 재검증이 잡아 재수정 |
| F-7 | P3 | /proc/version 대소문자 구분 — WSL1("Microsoft") 미탐지 | 수정: toLowerCase. WSL2 호스트에서 "detected via /proc" 힌트 실관측 유지 |
| 추가 | P3 | (검증 중 발견) tar 스폰 실패(lean PATH)가 raw error로 새어남 | 수정: 추출 단위 전체 저하 경로(로그+undefined) — tar/xz 부재 환경에서 힌트로 종료 확인 |

### 잔여 한계(추가)

- scriptc 자체가 native 아카이브 패킹에 시스템 `ar`을 요구 — clang/cc/ar가 전무한 호스트의 native 타깃은 이번 라운드 범위 밖(wasm-only가 폴백). F-1 검증은 ar 있는 시나리오.
- F-3 재설정·F-4 타임아웃·F-5 가드는 코드 수준 검증(실네트워크 장애/미지원 arch 호스트 미보유).
- Windows 분기(junction·bsdtar zip·zig.exe)는 리뷰어와 동일하게 읽기 검증만.
- 최종 상태: 수정 후 전체 `bun run test` rc=0(105 tests, 0 fail, 11.3s), bun-app 444ms·vite ssr+wasm+dropin 1.2s 스모크 rc=0.
