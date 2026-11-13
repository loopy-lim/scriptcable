# scriptc 툴체인 추적 업데이트 (0.4.9 → 0.4.12)

- **날짜:** 2026-11-13 · **요청:** "scriptc 업데이트로 따라가기, 간단한 성능 향상 + Bun AoT 확인"
- **기준 리비전:** main @ 6a46ecf (scriptc 0.4.9 추적 상태, 작업 트리 clean)
- **선행 계획:** `2026-11-07-scriptc-track-update.md` (0.4.0 → 0.4.9, 같은 패턴)

## 목표 (AC)

| AC | 내용 | 검증 |
|---|---|---|
| AC-1 | 모든 핀이 scriptc/`@scriptc/runtime-wasm32-wasi` **0.4.12**(2026-11-11, npm latest)를 가리킨다 — 루트, examples 7개(deno·workers의 runtime 핀, RN의 `runtime-android-arm64` 0.4.9 exact 포함), `resolveScriptc` 자동설치 플로어, `init` 스캐폴드 | V-1 |
| AC-2 | 0.4.12로 13패키지 빌드·전체 테스트·bun/node e2e 실호출이 성공한다 (캐시 무효화 관찰 포함) | V-2 |
| AC-3 | 문서(README/ko, getting-started doctor 샘플, toolchain zig 안내, CHANGELOG)가 0.4.12 검증 사실을 반영한다 | V-3 |
| AC-4 | Bun AoT(1.4.1 `--compile --bytecode`) 조사 결과가 문서로 남는다 | V-4 |

## 조사 사실

- upstream 0.4.10(11/9)·0.4.11(11/10)·0.4.12(11/11) 릴리스 노트 전수 확인 — **Breaking changes 섹션 없음**. 전부 성능·메모리·Node/TS parity·수정.
- 성능 하이라이트: 컴파일러 자체 빌드 최대 9.8% 향상, lowering 25–43% 감소 + 대형 프로그램 피크 메모리 2.2–2.9 GB 절감, 주석만 고친 리빌드 146.5 s → 1.7 s, typed-array 변환 61.2 ms → 1.9 ms, 동적 키 쓰기 명령수 절반, promise reaction 2,060 ns → 111 ns (fiber 제거), backend noinline 체인으로 프로그램당 1.17–1.49x.
- `@scriptc/runtime-wasm32-wasi`·`@scriptc/runtime-android-arm64` 모두 0.4.12 동반 릴리스 — `ensureRuntimePack` 정합 자동.
- 캐시 해시는 0.4.9 라운드에서 이미 `toolchainVersion` 포함(`build-cache.ts`) — 코드 변경 불필요, 핀 bump만으로 기존 프로젝트 재컴파일 보장.
- **Bun AoT**: Bun 1.4.1(2026-09경)의 `bun build --compile --bytecode` 개선 — 직렬화 바이트코드 9x → 3x 축소(Claude Code 설치 376→207 MB), `--bytecode-depth` (중첩 함수 AoT 깊이 제한), `--bytecode` 크로스컴파일 지원, 컴파일 실행파일 로더 fast path(시작 20% 향상). 본 레포는 이미 bun 1.4.3(개선 포함)이지만 `bun build --compile` 산출물이 없어 적용 지점 없음 → `docs/research/2026-11-13-bun-aot-notes.md`에 정리.

## 태스크와 검증

- **T-1** (Platform/Tooling Engineer): 핀 갱신 + `bun install` lock 재생성 — 완료.
- **T-2**: 문서 갱신(toolchain zig 문구, getting-started, README/ko, CHANGELOG) — 완료.
- **T-3**: 계획·조사 문서 작성 — 완료.

| V | 명령/관찰 | 결과 |
|---|---|---|
| V-1 | stale 핀 grep(정규식 `0\.4\.(0|9)`) 매니페스트·toolchain·init → 0건 — deno·workers의 `scriptc ^0.4.0` 2건은 독립 리뷰 F-1 지적으로 수정 반영; `bun.lock`에 `scriptc@0.4.12` | PASS |
| V-2 | `bun run build` 13패키지 exit 0 · `bun run test` 전 패키지 exit 0(core 120 pass) · `test:e2e:bun`/`test:e2e:node` `{"sum":42,…}` 실호출 · calculator-core `.scriptca` 재생성(캐시 무효화) | PASS |
| V-3 | README/ko·getting-started·toolchain 문구·CHANGELOG diff 대조 | PASS |
| V-4 | `docs/research/2026-11-13-bun-aot-notes.md` 존재 | PASS |

## 독립 평가 (G3+G5)

- 평가 직군: independent Release Gatekeeper(Staff Code Reviewer 겸임) · 판정 **PASS**
- 교차검증 트리아지: `scriptc --version` 0.4.12 실측 · core 테스트 재실행 120 pass · upstream 릴리스 노트 원문 대조 · Bun 1.4.1 블로그 원문 대조 / 오탐 기각 없음
- F-1 (P2): examples/deno·workers의 `scriptc ^0.4.0` 잔존 → 수정 완료 + `bun install`(lock 변동 없음 — 이미 0.4.12로 해석 중) + widened grep 재검증 통과

## 남은 한계

- zig 0.16.0 로컬 검증(wasm 플러그인 테스트 통과)은 macOS arm64 한 환경. CI zig 0.13.0 경로는 다음 CI 실행으로 확인.
- android-arm64 exact 핀(0.4.12)은 빌드 검증 안 함(RN 에뮬레이터 경로는 별도 블로커 — `memory/android-emulator-workflow-arm64-blocker`).
