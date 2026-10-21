[English](./README.md) | Korean

# scriptcable

하나의 **TypeScript** 코어 → **Bun, Node, Tauri, React Native, Lynx, Vite, Next.js**용 타입 안전 클라이언트.
[Vercel scriptc](https://scriptc.dev)가 **네이티브** 라이브러리(기본, `.lib.a` → `.so`/`.dylib`/`.dll`)로 컴파일하고, WASM은 브라우저용 선택 사항이며, CI 계약이 깨지는 API 변경을 막습니다.

[rustra](https://github.com/loopy-lim/rustra)에서 영감을 받았습니다. Rust 코어 자리에 **scriptc**를 두고, 도구와 앱 전부를 **Bun**으로 실행합니다.

## 5분 퀵스타트

**필요:** Bun ≥ 1.2와 `clang`(네이티브 공유 라이브러리 링크). WASM(`--target wasm`)을 쓸 때만 [zig 0.13.x](https://ziglang.org/download/).

**아래 명령은 끝까지 실행해 검증됐습니다 — 각 단계에서 나와야 할 출력까지 [docs/getting-started.md](./docs/getting-started.md)에 정리**되어 있습니다. 막히면 [docs/troubleshooting.md](./docs/troubleshooting.md)에서 실제 에러와 해결법을 찾으세요.

```bash
# 이 모노레포에서 bun install && bun run build 이후
bun packages/cli/dist/index.js init demo --host bun --from .
# npm 발행 후: bunx @scriptcable/cli init demo --host bun

cd demo
bun install
bun run doctor && bun run build && bun start
# → {"sum":42,"hi":"hello, bun"}
```

`src/core.ts`의 exports를 수정한 뒤 다시 빌드하세요. 설정 파일(`scriptcable.config.ts`)이 없어도 name·entry·exports는 자동 추론됩니다 — 아래 [제로 설정](#제로-설정-zero-config) 참고.

## 동작 방식

```
TypeScript 코어  →  scriptc 라이브러리 (WASM / .lib.a)  →  생성 클라이언트 + 어댑터
```

기본 산출물은 **네이티브**입니다. 브라우저처럼 네이티브를 쓸 수 없는 곳에서만 WASM을 선택하세요.

Bun은 **bun:ffi**(내장)로 공유 라이브러리를 로드합니다. 순수 Node에서는 `koffi`를 선택적 폴백으로 설치할 수 있습니다.

## 제로 설정 (Zero-config)

설정 파일이 없어도 동작합니다. `package.json`과 표준 위치의 코어만 있으면 됩니다:

```bash
bunx scriptcable build          # name은 package.json에서, entry는 src/core.ts에서 추론
```

모든 값이 추론됩니다 (우선순위: 명시적 설정 > 추론):

| 필드 | 추론 출처 |
|------|-----------|
| `exports` | 엔트리의 export 함수 TS 타입 |
| `name` | `package.json` `name` (스코프 `@scope/my-pkg` → `scope_my_pkg`), 없으면 디렉터리 이름 |
| `entry` | `src/core.ts` → `core.ts` → `src/index.ts` → `index.ts` 중 첫 존재 |
| `prefix` | `name` + `_` |
| `outDir` | `.scriptcable` |
| `target` | `native` (WASM은 선택) |

설정 파일은 재정의하고 싶은 값만 담습니다 — `name`/`entry`도 생략 가능:

```ts
// scriptcable.config.ts — 전부 선택
import { defineConfig } from '@scriptcable/core';
export default defineConfig({});            // 전부 추론
export default defineConfig({ name: 'mycore' }); // entry는 추론
```

Vite / Next.js / Webpack 플러그인도 같은 해석을 씁니다 (`scriptcable.config.ts` 포함), 어댑터는 `.scriptcable`이 기본값:

```ts
import { createBunEngineFromOutDir } from '@scriptcable/bun';
const engine = await createBunEngineFromOutDir(); // → ./.scriptcable
```

## 임포트 하나: `@scriptcable/client`

모든 빌드는 생성된 클라이언트를 **실제 패키지**로 내보냅니다. `scriptcable build`가 `.scriptcable/generated/`에 패키지 매니페스트를 쓰고 `node_modules/@scriptcable/client`로 링크합니다. 앱 코드는 `.scriptcable/` 경로를 전혀 참조하지 않습니다:

```ts
import { createClient } from '@scriptcable/client';

const client = await createClient();
client.add(20, 22); // 42
```

export conditions가 환경별로 알맞은 플레이버를 골라 줍니다 — 앱 코드에는 분기가 없습니다:

| 환경 | 플레이버 |
|---|---|
| Bun 런타임 | `bun.ts` (bun:ffi 네이티브) |
| Node 런타임 — Next 서버 컴포넌트, 라우트 핸들러, 서버 액션 | `node.ts` (네이티브 공유 라이브러리, WASM 폴백) |
| 프로젝트 파일을 서빙하는 브라우저 번들 (예: `vite dev`) | `browser.ts` (WASM — 최소 WASI 폴리필 내장, 인자 없이 동작) |
| Metro (React Native) | `react-native.ts` (브리지 기반) |

`browser` 플레이버는 생성 모듈 옆의 WASM을 fetch합니다 — 번들러가 프로젝트 파일을 서빙하는 곳(`vite dev`)에서 동작합니다. Next.js 클라이언트 그래프에서는 `<name>.wasm`을 정적 디렉터리에 복사하고 `createClient({ wasmUrl: '/<name>.wasm' })`로 호출하세요. 서버 코드는 아무 것도 필요 없습니다 — node 플레이버가 공유 라이브러리를 자동 로드합니다.

플레이버를 고정하려면 서브패스를 씁니다: `@scriptcable/client/node`, `/bun`, `/browser`, `/react-native`, `/lynx`, `/tauri`. 에디터도 같은 패키지를 해석하므로 `paths` 설정 없이 TypeScript가 동작합니다. 번들러 플러그인도 같은 emit을 씁니다. `withScriptcable`(자동 `transpilePackages` 포함)과 Webpack/Rspack 플러그인은 `next dev` / `next build` 중에 링크를 만들고, Turbopack은 predev의 `scriptcableBuild()`가 처리합니다.

링크가 없으면(첫 빌드 전 새 체크아웃) `scriptcable doctor`가 상태를 보고하고 복구합니다. CI에서 내구성을 원하면 의존성에 `"@scriptcable/client": "file:.scriptcable/generated"`을 추가하세요.

### 이전 → 이후: 알아야 했던 것

scriptcable을 쓰려면 일곱 가지를 알아야 했지만, 이제는 하나(`scriptcable build` 또는 이를 대신 돌려 주는 번들러 플러그인)면 됩니다:

| 알아야 했던 것 | 이전 | 이제 |
| --- | --- | --- |
| 설정 파일 | `scriptcable.config.ts` 필수 (`name`, `entry`) | 선택 — package.json·표준 위치에서 추론 |
| 생성물 경로 | `.scriptcable/generated/` 상대경로, `outDir` 옵션 | 없음 — bare import 하나 |
| 플레이버 선택 | 호스트별 어댑터/파일 직접 선택 | 환경별 자동 (export conditions) |
| 브라우저 WASI 어댑터 | `createMinimalWasi()` 구성·전달 | `createClient()` 무인자 |
| 번들러 설정 | 수동 alias/transpile (Next), JSON 전용 플러그인 설정 | 플러그인이 전부 처리 |
| 에디터 타입 | tsconfig `paths` 수동 | 실제 패키지 — 그대로 해석 |

```ts
// 이전 — 호스트별 import, 경로, 어댑터
const engine = await createNodeEngine({ outDir: '.scriptcable' });

// 이후 — Bun, Node, Next 서버 코드, 브라우저에서 동일
import { createClient } from '@scriptcable/client';
const client = await createClient();
```

편의를 위한 속도 희생은 없습니다. 모든 환경에서 측정된 엔진 속도 그대로 호출됩니다(BENCHMARK.md — 네이티브/WASM ~73ns, 브라우저 WASM 48ns, RN 브리지 홉 sub-µs).

## 어댑터 퀵스타트

### Bun

```bash
bun run --filter @scriptcable/example-calculator-core build
bun run --filter @scriptcable/example-bun-app start
```

### Node

```bash
bun run --filter @scriptcable/example-node-app start
```

### Vite

```ts
import scriptcable from '@scriptcable/vite';
export default { plugins: [scriptcable()] };
```

실행은 `bun --bun vite` (툴체인 검사가 Bun 런타임 기준으로 동작).

### Next.js / Turbopack

```js
import { withScriptcable } from '@scriptcable/next';
export default withScriptcable({}); // transpilePackages 자동 추가
// Turbopack: predev에서 scriptcableBuild()
import { scriptcableBuild } from '@scriptcable/next';
await scriptcableBuild();
```

### Tauri

Tauri Rust 셸에서 `scriptcable build`의 `lib{name}.a`를 링크(build script / `cc`)하고 C ABI 심볼을 `#[tauri::command]`로 래핑하세요. 웹뷰는 `createTauriSidecarEngine`로 브리지.

### React Native / Lynx

scriptc iOS/Android 아카이브를 네이티브 모듈(Xcode / NDK CMake)에 링크하고 `createReactNativeEngine` / `createLynxEngine`으로 브리지하세요. Lynx 번들링은 `@scriptcable/webpack`의 `ScriptcaRspackPlugin` 사용.

## CI 계약 게이트

```bash
scriptcable build                       # .scriptcable/contract.json 생성
scriptcable diff --fail-on-breaking     # 제거/시그니처 변경 시 exit 1
```

## 모노레포 스크립트

```bash
bun install
bun run build
bun run test
```

참고: `scriptc`는 설치 스크립트를 실행해야 하므로 루트 `package.json`의 `trustedDependencies`에 이미 등록되어 있습니다.

## 라이선스

MIT
