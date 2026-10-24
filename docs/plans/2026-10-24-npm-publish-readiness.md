# npm 발행 준비(publishability) 라운드 — 2026-10-24

## 요구

노스스타("TypeScript 프로젝트에 scriptcable만 추가하면 알아서 다 잘 되는")의 최대 병목은
발행 전 상태다. README.ko가 `# npm 발행 후: bunx @scriptcable/cli init`를 전제하고,
잔여 한계 2건(standalone Deno의 core 해석, 코드젠 CLI 배포)이 발행에 매달려 있다.
현 시점 13개 `@scriptcable/*` 패키지 모두 `repository`·`publishConfig` 필드가 없고,
expo만 LICENSE 파일이 없으며, 발행 자동화(워크플로)가 없다.

**범위**: 발행 가능성 완비(매니페스트·타르볼 검증) + 태그 기반 발행 자동화 + F-2 결함
(init 절대경로 name 맹글링 — 발행되면 `init`이 모든 사용자의 첫 명령이 되므로 함께 수정).
**범위 밖**: 실제 `npm publish`(NPM_TOKEN·npm 조직 권한은 사용자 외부 의존), provenance
(bun 1.4.4 publish에 미지원, 로컬 npm 없음).

## 조사 결과 (근거)

- `bun pm pack`이 `workspace:*`를 실버전(`0.1.0`)으로 리라이트함을 실측(types·vite 타르볼
  package.json 검사). tarball은 순수 tsc 산출 dist만으로 구성 — clang/zig 불요.
- `@scriptc/runtime-wasm32-wasi`는 core가 임포트하는 게 아니라 `ensureRuntimePack`이
  **사용자 프로젝트에** `bun add --dev`하는 것(`packages/core/src/toolchain.ts:236`) —
  발행 core에 런타임 팩 의존성 불필요.
- expo만 `LICENSE` 파일 부재(files에도 미등록). 나머지 12개는 LICENSE·README·files 완비.
- git remote: `https://github.com/loopy-lim/scriptcable`.
- cli bin 진입점 `#!/usr/bin/env bun` shebang 확인(`packages/cli/src/index.ts:1`).
- F-2 위치: `packages/cli/src/commands/init.ts:57` — `opts.name`을 그대로 슬러그화해
  `/tmp/sc-perf-demo` → `name: "-tmp-sc-perf-demo"`(basename 추출 없음).
- CI 모델: `.github/workflows/ci.yml`(setup-bun@v2, 패키지별 테스트).

## 수락 기준

| AC | 내용 | 관찰 방법 |
|----|------|-----------|
| AC-1 | 13개 패키지 전부 발행 가능한 매니페스트(repository·bugs·homepage·`publishConfig.access="public"`)를 가지고, expo에 LICENSE 파일이 있으며 files에 등록된다 | 각 package.json 필드 검사 + 전 패키지 `bun pm pack` rc=0 |
| AC-2 | pack된 tarball만으로 클린룸 프로젝트에 설치해 핵심 패키지 임포트(core 루트+서브패스, types, node, bun, testing, react-native, tauri, lynx, cli/codegen)가 해석되고, tarball manifest에 `workspace:` 프로토콜이 남지 않는다(npm이 프로토콜을 소비하는 지점은 manifest뿐 — G3 F-2 정렬) | `scripts/pack-smoke.ts` rc=0 + 리라이트 로그 |
| AC-3 | 태그 `v*` 푸시로 버전 일치 검사 → 빌드 → pack 스모크 → 의존성 순서 `bun publish --access public`(13종)가 실행되는 `.github/workflows/release.yml`이 있다 | YAML 파싱 + 버전 검사 스크립트 로컬 실행(태그 불일치 시 rc≠0 확인) |
| AC-4 | `init`이 경로 인수의 basename을 패키지 name으로 쓴다 — `/tmp/sc-perf-demo` → `sc-perf-demo`(소문자, 선행 하이픈 없음). 명시적 `--name`은 존중 | 신규 테스트 통과 + 기존 cli 테스트 회귀 0 |
| AC-5 | README 2종에 발행 운용 방식(태그 릴리스, NPM_TOKEN 전제)이 문서화되고 CHANGELOG에 기록된다 | 문서 diff |

## 태스크

| # | 내용 | 의존 |
|---|------|------|
| T1 | 13개 package.json에 repository/bugs/homepage/publishConfig 추가, expo LICENSE 추가 | - |
| T2 | `scripts/pack-smoke.ts` — 13종 pack → `workspace:` 잔존 검사 → 클린룸 설치 → 임포트 해석 → cli bin 스모크 | T1, build |
| T3 | `scripts/check-release-version.ts`(태그↔매니페스트 버전 일치) + `.github/workflows/release.yml` | T2 |
| T4 | init F-2 수정 + 테스트(basename 추출, 소문자화, 선행 하이픈 제거) | - |
| T5 | README·README.ko 발행 섹션 + CHANGELOG | T3 |
| T6 | 전체 회귀: `bun run build && bun run test`(zig PATH 세팅) | T1–T4 |

## 검증 계약

- 실행 환경: WSL2 로컬(bun 1.4.4, zig는 `~/tools/zig-linux-x86_64-0.13.0` PATH 세팅).
- V-1: `bun pm pack` ×13 rc=0 (AC-1)
- V-2: `bun run build && bun scripts/pack-smoke.ts` rc=0 — 리라이트·임포트 로그 남김 (AC-2)
- V-3: `bun scripts/check-release-version.ts v0.1.0` rc=0, `v9.9.9` rc≠0; release.yml YAML 파싱
  (bun YAML 파서 없으면 구조 정적 검증) (AC-3)
- V-4: `bun test packages/cli` — init 신규 테스트 포함 0 fail (AC-4)
- V-5: `bun run test` 전체 0 fail (T6)
- 평가자: 위임 도구 사용 가능 — G3 코드 리뷰는 독립 리뷰어로 실행.

## 가정 로그

- **버전 운용**: 13종 모두 0.1.0 동기 버전, 태그 `v0.1.0` 초기 발행 전제. changesets 미도입
  (모노레포 전체 동기 릴리스 관례상 태그 단일 버전 + 일치 검사로 충분, 의존성 최소 유지).
- **provenance**: bun 1.4.4 publish에 `--provenance` 플래그 없음(도움말 실측) — 미지원,
  잔여 한계로 기록. 서명 요구가 생기면 npm CLI 경로 별도 과제.
- **publish 인증**: 워크플로는 `.npmrc`의 `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`
  + `NPM_TOKEN` 시크릿 전제(bun이 .npmrc를 읽음). 실발행 검증은 토큰 없어 불가 — 정적 검증으로 대체.
- **next/vite/webpack/expo의 피어 미설치 임포트**: 클린룸에서 피어 없이 설치만 확인하고
  임포트 단언은 피어 비의존 9패키지에만 적용(vite plugin의 vite 런타임 임포트 여부는
  스모크 결과로 관찰해 기록 — 실패 시 by-design 여부 판정 후 한계 기록).

## 잔여 한계

- **실제 npm 발행·조직(`@scriptcable`) 권한 확인은 사용자 몫** — `NPM_TOKEN` 시크릿 등록 후 첫 태그 푸시가 실런타임 검증(409 재발행 거부, 토큰 권한, `--access` 서버 효과 포함). 워크플로는 정적 검증 + 동일 커맨드 로컬 녹색으로 대체.
- provenance는 bun 1.4.4 publish 미지원 — 서명 필요 시 npm CLI 경로 별도 과제.
- deno/node 계층 런타임 검증은 CI 몫 유지(기존 한계).
- CLI의 Node 실행 감지 분기(`node dist/index.js` → 명시적 오류)는 로컬 node 미설치로 읽기 검증만 — bun 경로(라이브러리 임포트 무실행, bin 실행)는 스모크 실측.

## G3 리뷰 기록

독립 리뷰어(위임, 새 컨텍스트) — **PASS**. 작성자 검증 전수 재실행 일치(테스트 110 pass/0 fail, 스모크 23 임포트, 버전 검사 rc 3케이스), cli 가드 빌드 산출 실측, init F-2 테스트 재현, 스모크 전제 재현(bun add tarball → registry 404), workspace: 리라이트 독립 확인, release.yml 발행 순서 위상·인증 기계 경로(격리 HOME + .npmrc authToken 실측), AC-1 13패키지 스윕, AC-5 문서 일치. 결함 P3 3건 — 모두 처리:

- **F-1(P3)** `import.meta.main` Bun 전용 — `node dist/index.js` 시 침묵 no-op → **수정**: entry URL 대조(`pathToFileURL`) 병행 + Bun 부재 시 명시적 오류. bun 경로는 스모크 재실측, Node 경로는 읽기 검증(위 한계).
- **F-2(P3)** AC-2 문구 vs 스모크 범위(workspace:를 manifest에서만 검사) → **계획 문구 정렬**(npm이 프로토콜을 소비하는 지점은 manifest뿐).
- **F-3(P3)** release.yml이 ci.yml(`on: push` 무필터)과 병렬 — 테스트 실패 태그도 발행 가능 → **수정**: `test` job 선행(ci.yml 툴체인 세팅 이식) + `publish: needs: test`.

수정 후 영향 증거 갱신: 전체 테스트 rc=0(110/0), pack-smoke PASS(23 임포트 + bin --help), YAML 파싱(test→publish needs 체인), typecheck 12패키지 rc=0, cli init 테스트 3 pass.

## 완료 실측

- **V-1 (AC-1)** `bun pm pack` ×13 rc=0 — pack-smoke 내 수행, 13 타르볼 생성 + publishConfig/files/LICENSE 검사 통과.
- **V-2 (AC-2)** pack-smoke rc=0 — 23개 임포트 ok(core 루트+8 서브패스, types, node, bun, testing, react-native, tauri, lynx, cli, cli/codegen), next/vite/webpack peer-free 임포트, expo만 피어 부재 skip(by design), cli bin `--help` ok. 외부 의존은 tarball이 선언한 범위 그대로 `bun add`(소비자 경로) 설치. `workspace:` 잔존 0(리라이트 실측: `workspace:*` → `0.1.0`).
- **V-3 (AC-3)** check-release-version `v0.1.0` rc=0 / `v9.9.9` rc=1 / `notatag` rc=1, release.yml YAML 파싱(jobs: test→publish, 13패키지 의존 순서 발행).
- **V-4 (AC-4)** cli 테스트 3 pass — 기존 1 + F-2 회귀 2(절대경로 basename 도출, 비URL basename `app` 폴백). 전체 테스트 **110 pass / 0 fail**(수정 후 재실행).
- **V-5 (T6)** `bun run test` rc=0 (zig PATH 세팅, pretest 자동 빌드).
- **라운드 내 발견·수정 결함**: cli 진입점이 `import.meta.main` 가드 없이 top-level `main()`+`process.exit` — 라이브러리 임포트만으로 CLI 실행·프로세스 사망(스모크가 잡음) → 가드+Node 실행 감지로 수정, 스모크 재검증.
