# npm 단일 패키지 발행 전환 — @unikit-bridge/scriptca

- **날짜:** 2026-11-13 · **요청:** "unikit으로 등록하자" (사용자 기억: unikit-bridge) → 조사 결과 사용자 소유 조직 `unikit-bridge` 존재, 단일 패키지 구조 선택
- **기준 리비전:** main @ ba94e3f (scriptc 0.4.12 추적 직후)
- **범위 메모:** 원 `/sdd`는 scriptc 추적 + 간단 성능(+ Bun AoT 참고)이었으나, 사용자가 발행 이름을 `@unikit-bridge`로 등록하기로 방향을 바꿈. 본 계획은 그 후속(단일 패키지 발행)만 다룸. 성능/AoT는 별도 후속.

## 배경과 결정

- 기존 13종 `@scriptca/*` 발행 계획은 이름 충돌(사용자의 다른 활성 프로젝트 `@unikit-bridge/{types,node,testing,react-native}` — Rust 코어 프로젝트, 2026-11-09 발행 중)과 신규 조직 생성 필요 때문에 폐기.
- **결정:** 단일 패키지 **`@unikit-bridge/scriptca@0.1.0`** — 기존 조직 재사용, 충돌 없음, 설치 DX 단순(import 지점에서 host 선택).
- bare `unikit` 패키지는 타인 소유(v1.3.46) — 스코프 `@unikit` 생성 불확실성 회피.

## 아키텍처

- **개발 구조 유지**: 13개 workspace 패키지(@scriptca/*, 내부용)는 그대로. `private: true` 전환으로 발행 대상에서 제외.
- **조립 패키지** `packages/scriptca` (유일 발행물): 13종 `dist/`를 `dist/<pkg>/`로 복사 + import specifier rewrite + exports 맵 자동 생성(각 패키지 exports에서 파생, drift 시 assert 실패). bin `scriptca` → `dist/cli/index.js`.
- **rewrite 규칙(조립 시)**: `@scriptca/client` → `@unikit-bridge/scriptca-client`, 이후 `@scriptca/` → `@unikit-bridge/scriptca/`. 게이트: dist에 `@scriptca` 잔존 시 빌드 실패.
- **소스 수준 사용자 노출 이름 변경**(발행물·생성 코드 정합):
  - 생성 클라이언트 placeholder 패키지명 `@scriptca/client` → `@unikit-bridge/scriptca-client` (client-package.ts 중앙 상수 + 플러그인 intercept/doctor/init/예제)
  - codegen 템플릿 런타임 import: `@scriptca/core/native|wasm|batch|wasi`, `@scriptca/types` → `@unikit-bridge/scriptca/...`
  - init 스캐폴드 deps: 13종 개별 항목 → `@unikit-bridge/scriptca: ^0.1.0` 단일 항목
- **발행 인프라 1종화**: check-release-version(단일 매니페스트), pack-smoke(단일 tarball + subpath import + 잔존 게이트 + bin), release.yml(순서 발행 루프 → 1회).

## 수락 기준

| AC | 내용 | 검증 | 상태 |
|---|---|---|---|
| AC-1 | `packages/scriptca` 조립 빌드가 13종 dist를 모아 exports 맵을 생성하고, dist에 `@scriptca` 문자열이 0건이다 | V-1 `bun run build` (조립 단계) | PASS (선행 런: 13패키지·49파일 rewrite·잔존 0) |
| AC-2 | pack-smoke: 단일 tarball의 클린룸 설치 + subpath import + bin `--help` 통과 | V-2 `bun scripts/pack-smoke.ts` | PASS (선행 + 재개 시 재실행) |
| AC-3 | 전체 빌드·테스트·bun/node e2e가 새 이름으로 통과 | V-3 `bun run test` + e2e | PASS (선행 런: 전체 스위트·e2e) |
| AC-4 | check-release-version v0.1.0 ↔ 매니페스트 일치, release.yml이 단일 패키지를 발행 | V-4 `bun scripts/check-release-version.ts v0.1.0` + release.yml 검토 | PASS |
| AC-5 | 문서(README/ko·getting-started·CHANGELOG)가 설치·사용법을 새 이름으로 안내 | V-5 문서 대조 | PASS (재개 시 수정: 13종→단일, example filter 복원, CHANGELOG Unreleased) |

## 태스크

| ID | 내용 | AC | 상태 |
|---|---|---|---|
| T1 | `packages/scriptca` 조립 + rewrite + exports | AC-1 | done |
| T2 | 소스/생성 코드·예제·플러그인을 `@unikit-bridge/...`로 전환 | AC-3 | done |
| T3 | 내부 13종 `private: true`, 루트 build 2단계 | AC-1 | done |
| T4 | pack-smoke / check-release-version / release.yml 1종화 | AC-2, AC-4 | done |
| T5 | README·ko·getting-started·CHANGELOG 사용자 안내 | AC-5 | done (429 중단 후 재개 완료) |
| T6 | G3 지적: troubleshooting.md + README.ko 패키지 표 | AC-5 | done (G3 Medium/Low) |

## 관문

| 관문 | 판정 | 비고 |
|---|---|---|
| G3 코드 리뷰 | PASS | 발행 경로 High 결함 없음; troubleshooting Medium → T6 수정 |
| G5 완료 | PASS | AC-1..5 독립 재검증 PASS; perf/AoT는 범위 밖 |
| 실 npm 발행 | 사용자 | `NPM_TOKEN` + `git tag v0.1.0 && git push` |

## 검증 기록

| ID | 명령 / cwd | 결과 | 비고 |
|---|---|---|---|
| V-1 | `bun run build` (repo root) | PASS | 선행 런: 조립 성공, `@scriptca` 잔존 0 |
| V-2 | `bun scripts/pack-smoke.ts` | PASS | 선행 PASS; 재개 후 재실행 |
| V-3 | `bun run test` + bun/node e2e | PASS | 선행 런 |
| V-4 | `bun scripts/check-release-version.ts v0.1.0` | PASS | `ok @unikit-bridge/scriptca@0.1.0` |
| V-5 | README/ko/getting-started/CHANGELOG 대조 | PASS | 발행 절·패키지 표·example filter·install 문구 |

## 남은 한계 (사용자 몫)

- GitHub 시크릿 `NPM_TOKEN` 등록 후 태그 `v0.1.0` push가 실발행 — org는 이미 존재(loopy-lim 소유).
- 원 요청의 scriptc 추적 성능 / Bun AoT 참고 개선은 본 계획 범위 밖(후속).
