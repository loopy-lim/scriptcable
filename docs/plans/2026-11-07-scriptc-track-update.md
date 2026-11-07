# scriptc 툴체인 추적 업데이트 (0.4.0 → 0.4.9)

- 날짜: 2026-11-07
- 기준 리비전: main @ 5f417ea (작업 트리 clean)
- 원 요청: "그러면 scriptc를 계속해서 따라와줄 수 있어?? 업데이트를 진행해주라."

## 목표와 범위

**사용자에게 달라지는 결과**

1. `scriptcable`이 scriptc **0.4.9**(2026-11-06 릴리스, npm latest)에서 검증·동작한다. 신규 설치뿐 아니라 **기존 프로젝트의 다음 빌드가 실제 0.4.9로 재컴파일**된다(캐시 무효화 포함).
2. scriptc가 없는 프로젝트에서 자동설치가 stale 핀(`^0.3.6`)이 아니라 현재 검증선(`^0.4.9`)을 설치한다.
3. 문서(README/ko, getting-started, CHANGELOG)가 0.4.9 검증 사실을 반영한다.

**범위 근거 (upstream 조사 완료)**

- scriptc 0.4.1~0.4.9에는 **Breaking changes 섹션이 없다**(0.2.0/0.3.0/0.4.0에만 존재 — upstream CHANGELOG 전수 확인). 라이브러리 모드 관련 수정: "Libraries that use untyped byte arrays link"(0.4.2), no-change 빌드 고속화(0.4.9). 나머지는 실행 파일 성능·Node parity·Node islands로 `build --lib` 계약 불변.
- `@scriptc/runtime-wasm32-wasi`도 0.4.9까지 동반 릴리스 — `ensureRuntimePack`은 scriptc와 동일 버전을 설치하므로 정합 자동.

**제외 범위**

- callbacks 네이티브 트램펄린 — 별도 계획(`2026-10-21-callbacks.md`) 유지. 0.4.9에 callbacks 관련 lib 변경이 없어 계획 전제(프로브 결과) 유효.
- Windows 로컬 검증 — CI(windows-latest 정식 편입)가 다음 푸시에서 검증. 잔여 한계로 기록.
- upstream 신버전 자동 추적 CI — 후속 제안으로 분리 (요청 범위: "업데이트를 진행").

**현재 구조와 근거 (조사 완료)**

| 위치 | 현재 동작 | 문제 |
|---|---|---|
| `package.json:29` + `examples/{next-app,vite-app,bench-core,dx-app,calculator-core}/package.json` | `"scriptc": "^0.4.0"` | 검증선 표기가 0.4.0에 머묾 (caret이라 신규 설치는 0.4.9 받음) |
| `package.json:28`, `examples/bench-core`, `examples/calculator-core` | `"@scriptc/runtime-wasm32-wasi": "^0.4.0"` | 동반 갱신 대상 |
| `packages/core/src/toolchain.ts:89` | 자동설치 `bun add --dev scriptc@^0.3.6` | **0.4.0 bump 때 누락된 stale 핀** — node_modules 부재 시 실제로 0.3.x를 설치하는 live 경로 |
| `packages/core/src/toolchain.ts:330` | 오류 문구 "zig 0.14 currently fails WASI builds with scriptc 0.3.x" | 0.3.x 표기 stale |
| `packages/core/src/build-cache.ts:146-165` (`computeBuildHash`) | 해시 표면 = name/prefix/exports/callbacks/optimization/target/sources | **scriptc 버전 미포함** — 툴체인 업데이트 후에도 `examples/*/.scriptcable`(0.4.0 산출물, 현재 존재)이 캐시 히트로 재사용됨. "scriptc를 따라간다"의 목표를 무력화 |
| `README.md:335` | "zig 0.13.x (verified with scriptc 0.4.0)" | 0.4.9 재검증 후 표기 갱신 |
| `docs/getting-started.md:66` | doctor 샘플 출력 `scriptc: 0.4.0` | 갱신 |
| `.github/workflows/ci.yml:26-30` | zig 0.13.0 명시 설치 | 변경 불필요 — 로컬 검증도 동일 0.13.0 사용 |

**환경·도구**: Bun 1.4.3, Apple clang 17, 로컬 zig은 homebrew 0.16.0(README 기준 0.13 밖) → WASM 검증은 CI와 동일한 zig 0.13.0을 `/tmp`에 추출해 PATH만 겹쳐 씀(전역 오염 없음). 검증 명령은 루트 `package.json` scripts(`build`/`test`/`typecheck`)와 examples 필터 스크립트.

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | 자동설치·문구의 stale 참조 제거 — `packages/` 소스에 `0.3.6` 참조가 없고 자동설치 핀이 검증선과 일치한다 | T-2 | V-1 |
| AC-2 | 툴체인 업데이트가 기존 프로젝트에 실제 적용된다 — scriptc 버전이 바뀌면 빌드 캐시가 무효화되어 재컴파일된다(동일 버전이면 캐시 유지) | T-3 | V-2 |
| AC-3 | scriptc 0.4.9 네이티브 파이프라인 — `bun install` 후 calculator-core 빌드가 0.4.9로 성공, shared library + N-API addon 생성, bun/node 앱 실호출 성공 | T-1, T-4 | V-3 |
| AC-4 | WASM 경로 — zig 0.13.0에서 wasm 빌드 성공, wasm 클라이언트 실호출 성공 | T-4 | V-4 |
| AC-5 | 회귀 없음 — `bun run test` + `bun run typecheck` 통과, `scriptcable diff --fail-on-breaking` 통과(계약 불변) | T-4 | V-5 |
| AC-6 | 문서 정합 — README/ko·getting-started·CHANGELOG가 0.4.9 검증 사실을 반영 | T-5 | V-6 |

## 태스크

- **T-1** (`Platform/Tooling Engineer`): 핀 갱신 — 루트 `package.json`(`scriptc`, `@scriptc/runtime-wasm32-wasi` → `^0.4.9`), examples 5개 `scriptc` → `^0.4.9`, `bun install`로 `bun.lock` 재생성. 파일: `package.json`, `examples/*/package.json`, `bun.lock`.
- **T-2** (`Backend/Core Engineer`): `toolchain.ts:89` 자동설치 핀 `^0.3.6` → `^0.4.9`, `:330` zig 문구의 "scriptc 0.3.x" 갱신. 파일: `packages/core/src/toolchain.ts`.
- **T-3** (`Backend/Core Engineer`): 캐시 해시에 툴체인 버전 포함 — `computeBuildHash`에 `toolchainVersion` 옵션 추가(해시 표면에 편입), `buildCore`가 `doctor()`의 `info.version`을 전달. 옵셔널이라 기존 직접 호출부·테스트 불변. 캐시 무효화 회귀 테스트 1건 추가. 파일: `packages/core/src/build-cache.ts`, `packages/core/src/build-cache.test.ts`, `packages/core/src/toolchain.ts`(전달 1줄).
- **T-4** (`Verification/Test Engineer` + 수행 직군): V-2~V-5 실행 — 설치 버전 확인, 캐시 무효화 관찰, calculator-core 네이티브+애드온 빌드와 bun/node e2e 실호출, zig 0.13 wasm 빌드·호출, 전체 test/typecheck/diff.
- **T-5** (`Skill/Prompt Engineer` 대신 문서 직군 = `Platform/Tooling Engineer` 겸장): README.md·README.ko.md·docs/getting-started.md·CHANGELOG.md 갱신. 파일: 문서 4종.

파일 소유권: T-1(package.json들) ∩ T-2(toolchain.ts) = ∅, T-3(build-cache.ts+test)은 T-2와 toolchain.ts를 공유하므로 **T-2 → T-3 순차**. T-5는 코드 확정 후.

## 검증 (V)

- **V-1**: `grep -rn '0\.3\.6' packages/` → 0건; `toolchain.ts` 자동설치 핀 = `^0.4.9`.
- **V-2**: 같은 입력으로 연속 빌드 2회 — 1회차 미스(버전 편입으로 무효화), 2회차 캐시 히트; scriptc 다운그레이드 시나리오는 해시 표면 검사로 대체(실제 다운그레이드 설치는 생략).
- **V-3**: `bun install` → `node_modules/scriptc` version=0.4.9; `scriptcable build` 로그에 addon 생성; `bun run --filter @scriptcable/example-bun-app start`와 `@scriptcable/example-node-app start` → `{"sum":42,...}`.
- **V-4**: zig 0.13.0을 `/tmp` 추출 → `build --target wasm` 성공 → wasm 클라이언트 `add(20,22)` 실호출(bun 테스트 경유).
- **V-5**: `bun run test`, `bun run typecheck`, calculator-core에서 `scriptcable diff --fail-on-breaking`.
- **V-6**: 문서 diff 대조 — 0.4.9 표기와 검증 날짜.

## 오류·경계

- 로컬 zig 0.16.0은 README 기준(0.13) 밖 — 검증은 CI와 동일 0.13.0 사용. 0.16에서의 동작은 이번 범위 밖(README 요구치 유지).
- 기존 `examples/*/.scriptcable` 0.4.0 산출물은 T-3 적용 후 첫 빌드에서 자동 무효화된다 — 수동 삭제 불필요(무효화 관찰이 곧 V-2 증거).
- 애드온이 Windows에서 빌드 불가인 것은 기존 설계(soft-fail) — 이번 업데이트로 변화 없음을 V-3 로그에서 확인.
- 0.4.9의 no-change 빌드 고속화는 scriptc 자체 캐시로, scriptcable의 캐시와 독립 — 상호 간섭 없음.

## 호환성·롤백

- caret 범위 내 패치 업데이트 — 프로파일 스키마·ABI·계약 해시 변경 없음(upstream Breaking 섹션 부재).
- 롤백: 핀을 `^0.4.0`으로 되돌리고 `bun install`; `toolchainVersion` 해시 편입은 캐시 포맷(v1) 불변 — 이전 캐시 파일과 호환(엔트리만 미스).
