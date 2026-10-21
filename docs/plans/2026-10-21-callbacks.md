# callbacks — 코어가 호스트 함수를 호출하는 경로

- 날짜: 2026-10-21
- 기준 리비전: main @ 32aff3d (scriptc 0.4.0, drop-in 실호스트 검증 완료)
- 원 요청: 2차 계획의 제외 항목 "callbacks 코어" — scriptc가 TS 레벨 i64/u64를 노출하면서 남은 마지막 미지원 ABI 기능.

## 목표와 범위

**사용자에게 달라지는 결과**

1. 코어가 호스트 콜백을 선언하면(`scriptcable.json`의 `callbacks`) 클라이언트가 `createClient({ callbacks: { onTick: (n) => ... } })`로 JS 구현을 넘기고, 코어의 네이티브/WASM 코드가 그것을 호출한다.
2. 콜백이 있어도 N-API 애드온이 더 이상 스킵되지 않는다 (현재는 `canBuildNodeAddon`이 false — "cores with callbacks skip the addon").

**제외 범위**

- scriptc 자체의 콜백 ABI 세부(등록 심볼 서명, 스레딩 제약)는 scriptc 문서/실험으로 확정된 것만 따른다. 이 문서의 태스크는 프로브로 확인된 사실 위에서만 설계한다.
- 멀티스레드/백그라운드 스레드에서의 콜백(스크립트 엔진 제약) — 1차는 동일 스레드 역호출만.

## 현재 구조와 근거 (2026-10-21 프로브 완료)

| 위치 | 현재 동작 |
|---|---|
| scriptc 0.4.0 (`/tmp` 프로브) | `callbacks` 섹션 + `callback_register_symbol`을 가진 lib 프로파일 **컴파일 성공** (`.scriptc/core.lib.a` 생성 확인) |
| `packages/core/src/profile.ts:19` | `config.callbacks` → 프로파일 `callbacks` + `callback_register_symbol` 이미 매핑됨 |
| `packages/core/src/wasm-loader.ts:199` | **WASM 경로는 콜백 구현 완료** — 등록 테이블에 JS 함수를 심어 코어가 호출 (렌더러/브라우저에서 동작 가능) |
| `packages/core/src/napi-addon.ts:24` | 콜백 있으면 애드온 스킵 (`canBuildNodeAddon` false) — 트램펄린 부재 |
| `packages/core/src/native-loader.ts` | 콜백 등록 경로 없음 — 네이티브 공유 라이브러리는 JS 역호출 불가 |
| scriptcable 추론 (`infer.ts`) | 콜백 선언은 `scriptcable.json` 명시만 (TS 소스에서 추론 안 함) |

**미확정 (태스크 T-0에서 확정할 것)**: `callback_register_symbol`이 기대하는 등록 함수 서명(함수 포인터 배열? 개별 등록?), 호출 규약(동기 역호출 시 스레드), WASM 경로의 등록 테이블과의 정합. scriptc 0.4 문서 부재 → 바이너리 프로브로 확정.

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | `callbacks` 선언 코어가 `scriptcable build`로 네이티브 공유 라이브러리 + 애드온을 모두 생성하고, JS에서 `createClient({ callbacks })`로 코어의 역호출이 JS 함수로 도달한다 (`bun test` 실호출) | T-1, T-2 | V-1 |
| AC-2 | 생성 클라이언트 타입이 `callbacks` 매개변수를 노출하고 (플레이버별), 누락 시 코어 호출 시점에 "pass callbacks: { … }" 안내 오류 | T-2 | V-2 |
| AC-3 | 콜백 유무와 무관하게 drop-in 3종 생성 규칙이 유지된다 (콜백 코어도 drop-in 가능 — 브라우저 플레이버는 WASM 경로이므로 이미 가능) | T-3 | V-3 |
| AC-4 | 문서(README/ko)에 callbacks 레시피 + 네이티브 호스트(C 측 등록) 레시피 기재, CHANGELOG 갱신 | T-4 | V-4 |

## 설계

**T-1 (코어: 네이티브 콜백 브리지)**

- 애드온 경로: `napi_create_threadsafe_function` 없이 1차는 **동기 역호출** — 애드온이 콜백 등록 심볼에 JS 함수 참조를 심는 C 트램펄린을 넘긴다. 트램펄린은 napi_call_function으로 JS를 부르고 반환값을 C ABI로 되돌린다 (같은 스레드 전제, env는 모듈 초기화 시 캡처).
- bun:ffi/koffi 경로: 트램펄린 생성 불가(JIT 금지) → 1차는 **FFI 경로에서 콜백 미지원 + 안내**(애드온 있으면 그쪽 사용 — 애드온이 기본 경로이므로 실제 손실 없음).
- 등록 서명은 T-0 프로브로 확정한 것 그대로.

**T-2 (codegen: 클라이언트 표면)**

- `genNodeClient`/`genBrowserClient`/drop-in: `createClient(options?)`에 `callbacks` 전달 추가. 브라우저는 기존 wasm-loader 시맨틱 재사용, node/bun은 `loadNativeLibrarySync(profile, callbacks)` 확장.
- 타입: 프로파일 callbacks → `Callbacks` 인터페이스 코드젠 (완전 타입).

**T-3 (정확성 게이트)**

- `canInterceptEntry`/애드온 스킵 해제: 애드온이 콜백을 지원하므로 스킵 근거 제거. 단 FFI 폴백(애드온 빌드 실패) 시 콜백 코어는 호출 시점 안내 오류 (기존 skip 근거가 폴백으로 이동).

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 ID |
|---|---|---|---|---|
| T-0 | 등록 서명 프로브 — scriptc 0.4 바이너리로 callback_register_symbol 시그니처 확정 | 없음 (조사) | 없음 | 기록 |
| T-1 | 네이티브 콜백 트램펄린 (AC-1) | `packages/core/src/napi-addon.ts` | T-0 | V-1 |
| T-2 | 클라이언트 callbacks 표면 (AC-1,2) | `packages/core/src/{codegen,native-loader}.ts` | T-1 | V-1, V-2 |
| T-3 | 애드온 스킵 해제 + 폴백 안내 이동 (AC-3) | `packages/core/src/{napi-addon,intercept}.ts` | T-1 | V-3 |
| T-4 | 문서 (AC-4) | `README.md`, `README.ko.md`, `CHANGELOG.md` | T-1~T-3 | V-4 |

## 검증 계획

| ID | 방법 | 기대 |
|---|---|---|
| V-1 | 콜백 코어 실빌드 → `bun`에서 `createClient({ callbacks })` → 코어가 onTick 3회 호출 단언 | 호출 횟수/인수 정확 |
| V-2 | 생성 클라이언트 문자열 검사 — callbacks 타입·안내 오류 | 케이스 pass |
| V-3 | drop-in 코드젠 테스트 — 콜백 코어의 drop-in 생성 | 케이스 pass |
| V-4 | 문서 검수 | 기재 확인 |
