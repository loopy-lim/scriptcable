[English](./README.md) | Korean

# scriptcable

하나의 **TypeScript** 코어 → **Bun, Node, Tauri, React Native, Lynx, Vite, Next.js**용 타입 안전 클라이언트.
[Vercel scriptc](https://scriptc.dev)가 **네이티브** 라이브러리(기본, `.lib.a` → `.so`/`.dylib`/`.dll`)로 컴파일하고, WASM은 브라우저용 선택 사항이며, CI 계약이 깨지는 API 변경을 막습니다.

[rustra](https://github.com/loopy-lim/rustra)에서 영감을 받았습니다. Rust 코어 자리에 **scriptc**를 두고, 도구와 앱 전부를 **Bun**으로 실행합니다.

## 5분 퀵스타트

**필요:** Bun ≥ 1.2와 `clang`(또는 gcc의 `cc` — 네이티브 공유 라이브러리 링크). WASM(`--target wasm`)을 쓸 때만 [zig 0.13.x](https://ziglang.org/download/).

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
| Deno 런타임 | `deno.ts` (컴파일된 `.js` — Deno는 `node_modules` 하위 타입 제거를 거부함; WASM은 생성 디렉터리에서 직접 읽음) |
| Cloudflare Workers | `workers.ts` (`workerd` 조건 — wasm은 wrangler의 정적 CompiledWasm import로 실림) |

`browser` 플레이버는 WASM 위치를 자동으로 찾습니다: 모듈 상대 위치를 먼저 프로브하고(번들러가 프로젝트 파일을 서빙하는 곳 — `vite dev` — 에서 동작), 다음으로 오리진 루트를 확인합니다. Vite / Next.js / Webpack 플러그인이 빌드마다 `<name>.wasm`을 정적 디렉터리(`public/`)에 복사하므로, 클라이언트 그래프에서도 `createClient()`가 수동 복사 없이 동작합니다. `createClient({ wasmUrl })`을 명시하면 항상 우선합니다(베이스 경로 뒤 배포, CDN 등). 서버 코드는 아무 것도 필요 없습니다 — node 플레이버가 공유 라이브러리를 자동 로드합니다.

플레이버를 고정하려면 서브패스를 씁니다: `@scriptcable/client/node`, `/bun`, `/browser`, `/react-native`, `/lynx`, `/tauri`, `/deno`, `/workerd`. 에디터도 같은 패키지를 해석하므로 `paths` 설정 없이 TypeScript가 동작합니다. 번들러 플러그인도 같은 emit을 씁니다. `withScriptcable`(자동 `transpilePackages` 포함)과 Webpack/Rspack 플러그인은 `next dev` / `next build` 중에 링크를 만들고, Turbopack은 predev의 `scriptcableBuild()`가 처리합니다.

링크가 없으면(첫 빌드 전 새 체크아웃) `scriptcable doctor`가 상태를 보고하고 복구합니다. `scriptcable init`은 CI 내구성을 기본으로 스캐폴드합니다: 의존성에 `"@scriptcable/client": "file:.scriptcable/generated"`을 기록하고, 첫 빌드 전에도 `bun install`이 깨지지 않도록 플레이스홀더 매니페스트와 gitignore 부정 패턴을 함께 만듭니다. `init` 외 경로로 만든 프로젝트는 `doctor`가 정확한 스니펫을 안내합니다.

### 변경 0: drop-in

번들러 플러그인을 등록만 하면 위 import조차 필요 없습니다. 플러그인이 코어 엔트리로 해석되는 모듈 import를 **생성된 drop-in 클라이언트**로 리다이렉트합니다 — export 이름·파라미터명·JSDoc이 원본과 동일하므로, 기존 코드는 그대로 `./core`를 읽고 번들만 컴파일된 라이브러리로 실행됩니다:

```ts
// 앱 코드 그대로 — 플러그인이 이 import 뒤의 모듈을 스왑
import { add } from './src/core';
add(20, 22); // 42, 네이티브 애드온 속도
```

| 호스트 | 가로채기 연결 | 검증 대상 |
|---|---|---|
| **Vite** | 자동 — `resolveId` (내장 리졸버보다 먼저 실행) | Vite 6 dev + build (2026-10-21) |
| **Webpack** | 자동 — `enhanced-resolve` 플러그인 | webpack 플러그인 테스트 + Next webpack 그래프(아래) |
| **Next.js (webpack)** | 자동 — client 그래프는 브라우저 drop-in, server/edge는 node | Next 16.4.2 `next build --webpack` + `next start` 런타임 호출 (2026-10-21) |
| **Next.js (Turbopack)** | 엔트리 drop-in 불가 — Turbopack에는 그래프별 resolve 훅이 없고, `resolveAlias`는 해석된 경로가 아니라 요청 specifier를 매칭합니다(절대경로 키는 아무 일도 안 함 — 검증). `@scriptcable/client`를 쓰거나(`transpilePackages`로 export conditions 동작), `next dev/build --webpack`으로 drop-in import | Next 16.4.2 turbopack 빌드 |
| **Rspack / Rspeedy (Lynx)** | Rspack의 Rust 리졸버에는 JS resolve 플러그인 훅이 없습니다(`resolve.plugins`가 설정 스키마에 없음 — 넣어도 조용히 무시). 플러그인은 빌드·패키지 링크를 계속 하고, import는 `@scriptcable/client` export conditions으로 해석 | Rspeedy 0.18.2 빌드 (번들에 browser 클라이언트 포함) |
| **React Native (Metro)** | `metro.config.js`에서 `@scriptcable/react-native/metro`의 `withScriptcableMetro()` | Metro 0.87 / RN 0.88 실번들 (2026-10-21) |
| **Expo** | 동일한 `withScriptcableMetro()` — Expo의 번들러는 Metro 그 자체입니다. `@expo/metro-config` 기본 설정 위에 등록하세요 (`metro.config.js`) | Expo 58 실제 metro 설정(`getDefaultConfig`) 번들 — drop-in 브리지 포함, 엔트리 소스 배제 (2026-10-22) |
| **Electron** | main: `import { createClient } from '@scriptcable/client'` (node conditions — 생성 패키지는 런타임 플레이버의 **컴파일된 `.js`를 함께 내보냅니다**. Electron의 Node는 `.ts`를 로드하지 못함), renderer: 기존처럼 Vite/Webpack 플러그인 | Electron 33 실런타임: main은 네이티브 코어 호출, vite 빌드 renderer는 커스텀 프로토콜로 WASM drop-in 호출 (2026-10-22) |
| **Astro / SvelteKit / Nuxt / Remix (React Router) / SolidStart** | 전부 Vite 내장 — `@scriptcable/vite`를 각자의 `vite.plugins`에 등록. Nuxt 4는 vite root를 `srcDir`(`app/`)로 옮기므로 프로젝트 루트를 명시하세요: `scriptcable({ root: import.meta.dirname })` | Astro 5.18, SvelteKit 2, Nuxt 4.6, React Router 8.5 (SPA 모드), SolidStart 2.0 (`@solidjs/start` + vite 8) — 실빌드: client 번들에 drop-in 포함, WASM 정적 산출 (2026-10-22) |
| **Rollup** | 동일 플러그인 (`root` 옵션) — `resolveId`는 rollup 표준 훅 형태. TS 변환과 `.js`→`.ts` 형제 해석은 호스트 몫(ts/esbuild 플러그인과 짝) | rollup 4 실빌드 — 엔트리 import가 drop-in으로 리다이렉트 (2026-10-22) |
| **Deno** | 플러그인 불필요 — export conditions가 `deno` 플레이버를 고릅니다(컴파일된 `.js`로 emit되고, Deno가 스스로 켜는 `node` 조건보다 **앞서** 매니페스트에 배치). 먼저 `scriptcable build --target wasm --hosts deno` (코드젠 CLI는 Bun에서 실행) | Deno 2.9 실런타임 — bare `@scriptcable/client` import + `deno run -A`, 플래그·설정 0 (2026-10-22) |
| **Cloudflare Workers** | 플러그인 불필요 — wrangler는 `workerd` 조건으로 번들을 해석하고, workers 플레이버는 wasm을 정적 import(wrangler 기본 CompiledWasm 규칙)하므로 fetch도 TLA도 없음 | wrangler 4.151 — dry-run 번들 + 실제 `wrangler dev`(workerd) HTTP 호출 42 (2026-10-22) |

drop-in 플레이버: 브라우저 그래프는 모듈 로드 시 top-level await로 WASM을 1회 초기화합니다(빌드 타깃 **ES2022+** 필요, 예: vite `build.target: 'es2022'`). 서버 그래프는 **await이 전혀 없습니다**(`createClientSync()` — CommonJS 출력 서버 번들에도 안전). Metro는 첫 호출 때 브리지 클라이언트를 lazy 생성합니다.

정확성이 우선입니다. 엔트리가 drop-in이 제공할 수 없는 것을 하나라도 export하면 — 함수 아닌 값, 클래스, `default`/re-export, 매핑 불가 타입의 함수, 또는 표면을 줄여 선언한 `exports` — 그 프로젝트는 가로채지 않고 이유 1줄을 알립니다. `dropin: false`(Vite/Webpack) 또는 `{ dropin: false }`(`withScriptcable`)로 완전히 끌 수 있습니다.

### 이전 → 이후: 알아야 했던 것

scriptcable을 쓰려면 일곱 가지를 알아야 했지만, 이제는 하나(`scriptcable build` 또는 이를 대신 돌려 주는 번들러 플러그인)면 됩니다:

| 알아야 했던 것 | 이전 | 이제 |
| --- | --- | --- |
| 설정 파일 | `scriptcable.config.ts` 필수 (`name`, `entry`) | 선택 — package.json·표준 위치에서 추론 |
| 생성물 경로 | `.scriptcable/generated/` 상대경로, `outDir` 옵션 | 없음 — bare import 하나, 또는 아예 없음(drop-in) |
| 플레이버 선택 | 호스트별 어댑터/파일 직접 선택 | 환경별 자동 (export conditions) |
| 브라우저 WASI 어댑터 | `createMinimalWasi()` 구성·전달 | `createClient()` 무인자 |
| 번들러 설정 | 수동 alias/transpile (Next), JSON 전용 플러그인 설정 | 플러그인이 전부 처리 |
| 에디터 타입 | tsconfig `paths` 수동 | 실제 패키지 — 그대로 해석 |
| **호출부** | `createClient()` + 메서드 호출로 재작성 | **그대로** — 플러그인이 `./core` import를 컴파일된 클라이언트로 리다이렉트 |

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
export default {
  plugins: [scriptcable()], // ./core import가 컴파일된 클라이언트로 해석됨
  build: { target: 'es2022' }, // drop-in 브라우저 클라이언트는 top-level await 사용
};
```

실행은 `bun --bun vite` (툴체인 검사가 Bun 런타임 기준으로 동작).

### Next.js

```js
import { withScriptcable } from '@scriptcable/next';
export default withScriptcable({}); // transpilePackages 자동 추가 + 그래프별 drop-in
// `next build --webpack` / `next dev` 로 실행하면 drop-in import가 켜집니다
```

Turbopack(Next 16 기본 번들러)에는 그래프별 resolve 훅이 없고, `resolveAlias`는
해석된 경로가 아닌 요청 specifier를 매칭합니다 — 절대경로 키는 아무 일도 하지
않습니다(16.4.2에서 검증: TS 엔트리가 그대로 그래프에 남았습니다). 이격 없는
가짜 alias는 설정하지 않습니다 — `withScriptcableAsync()`가 한 번 정확히 알려주고
import는 그대로 둡니다. 앱 코드는 `@scriptcable/client`를 import하면 되고,
export conditions가 두 그래프 모두에서 컴파일된 클라이언트를 전달합니다:

```js
import { withScriptcableAsync } from '@scriptcable/next';
export default await withScriptcableAsync({}); // 아티팩트 빌드 + @scriptcable/client 링크
```

### Tauri

Tauri Rust 셸에서 `scriptcable build`의 `lib{name}.a`를 링크(build script / `cc`)하고 C ABI 심볼을 `#[tauri::command]`로 래핑하세요. 웹뷰는 `createTauriSidecarEngine`으로 브리지. Vite로 빌드하는 Tauri v2 프런트엔드는 일반 웹 앱과 동일하게 Vite 플러그인의 drop-in 브라우저 클라이언트를 받습니다.

### Electron

새 패키지가 필요 없습니다 — Electron은 scriptcable 호스트 둘입니다 (`examples/electron-app`이 검증된 엔드투엔드 샘플):

```ts
// main 프로세스 (Node 런타임) — import 하나, export conditions가 네이티브
// node 플레이버를 선택; 호출은 동기
import { createClient } from '@scriptcable/client';
const client = await createClient();
client.add(20, 22); // 42

// renderer (vite/webpack로 빌드) — 평소처럼 플러그인 등록, ./core import가
// 브라우저 drop-in으로 해석됨
```

Electron 관련 참고 두 가지: 생성 패키지의 `bun`/`node` conditions은 **컴파일된 `.js`**를 가리킵니다(Electron의 Node 20은 `.ts`를 로드할 수 없어 빌드가 둘 다 내보냅니다). 그리고 `dist/`를 서빙하는 renderer는 커스텀 프로토콜이 필요합니다 — ready 전에 `protocol.registerSchemesAsPrivileged([{ scheme: 'scriptcable', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])`, 이후 `protocol.handle('scriptcable', …)`로 dist를 서빙하면 WASM `fetch()`가 동작합니다.

### React Native / Lynx

scriptc iOS/Android 아카이브를 네이티브 모듈(Xcode / NDK CMake)에 링크하고 `createReactNativeEngine` / `createLynxEngine`으로 브리지하세요. Lynx 번들링은 `@scriptcable/webpack`의 `ScriptcaRspackPlugin` 사용 — Rspack도 enhanced-resolve drop-in이 자동 연결됩니다.

**Android는 네이티브 쪽도 생성·완성됩니다**: `scriptcable build --platform android`가 android-arm64용 아카이브를 크로스컴파일(scriptc의 `@scriptc/runtime-android-arm64`)하고 생성된 JNI dispatch와 함께 하나의 `lib{name}_cable.so`로 링크합니다 — Kotlin 모듈(`CableModule.kt` + 패키지)이 함께 나옵니다. Expo 프로젝트는 `@scriptcable/expo` config plugin이 `expo prebuild` 때 전부 연결합니다 — 손으로 쓰는 네이티브 모듈도 CMake도 없습니다:

```json
// app.json
{ "expo": { "plugins": ["@scriptcable/expo"] } }
```

```bash
scriptcable build --hosts react-native
scriptcable build --platform android
bunx expo prebuild -p android
cd android && ./gradlew assembleDebug
```

기기 실측: Android 14 에뮬레이터에서 전체 체인 — RN JS → TurboModule interop → 생성 Kotlin 모듈 → JNI → C++ dispatch → 컴파일된 코어 — 이 `CABLE_RESULT:{"sum":42}`(logcat)로 동작합니다(`examples/react-native-app`, RN 없는 변형은 `device-jni-probe`). 생성 dispatch의 호스트 컴파일·JSON 브리지 계약은 `test:android`로 검증됩니다.

⚠️ 앱 gradle에 `externalNativeBuild` 블록을 절대 추가하지 마세요 — RN 0.88 gradle 플러그인이 자체 cmake(libappmodules.so = 코어 TurboModule 바인딩)를 주입하는데, 두 번째 블록이 그 경로를 덮어써 앱이 기동 시 "'PlatformConstants' could not be found"로 죽습니다. 플러그인 없이 쓰려면 `examples/react-native-app/scripts/wire-android.mjs`(완성 .so를 jniLib로 복사 — CMake 없음). ARM 번역 에뮬레이터에서는 앱을 arm64로 빌드하세요(`-PreactNativeArchitectures=arm64-v8a` — 프로세스 전체가 번역으로 실행).

Metro drop-in (`metro.config.js`, `scriptcable build --watch`를 Metro와 함께 실행):

```js
import { withScriptcableMetro } from '@scriptcable/react-native/metro';
export default withScriptcableMetro(getDefaultConfig(__dirname));
```

기기에서 TurboModule drop-in 호출은 Promise로 귀결됩니다 — 위 브리지 클라이언트와 동일한 시맨틱입니다.

**Expo**: 번들러는 여전히 Metro입니다 — Expo 자체 기본 설정을 감싸면 drop-in이 그대로 적용됩니다(`examples/react-native-app/scripts/expo-bundle.mjs`가 Expo 58의 실제 `getDefaultConfig` 위에서 검증된 스모크):

```js
// metro.config.js (Expo)
const { getDefaultConfig } = require('expo/metro-config');
const { withScriptcableMetro } = require('@scriptcable/react-native/metro');
module.exports = withScriptcableMetro(getDefaultConfig(__dirname));
```

### Deno / Cloudflare Workers

둘 다 번들러 플러그인 없이 생성 클라이언트를 실행합니다 — export conditions가 플레이버를 고르는, 다른 런타임과 같은 한 줄 import DX입니다:

```bash
scriptcable build --target wasm --hosts deno    # workers도 동일 (--hosts workers)
deno run -A src/main.ts                          # 안에서 @scriptcable/client를 bare import
```

- **Deno** (`examples/deno-app`): `deno` 플레이버는 **컴파일된 `.js`**로 emit됩니다(Deno는 `node_modules` 하위 타입 제거를 거부함) — 그리고 매니페스트는 `deno` 조건을 `node`보다 앞에 둡니다(Deno가 `node`를 스스로 켜므로). wasm은 생성 디렉터리에서 직접 읽어 URL 프로브가 없습니다. 일반 `deno run -A` — 플래그도 `deno.json`도 없습니다.
- **Cloudflare Workers** (`examples/workers-app`): `workerd` 플레이버는 wasm을 정적 import합니다 — wrangler의 기본 CompiledWasm 규칙이 컴파일된 모듈을 번들에 넣어주므로 `createClient()`에 fetch도 top-level await도 필요 없습니다. 실제 `wrangler dev`(workerd) 호출로 검증됐습니다.

공통 전제: 코드젠 CLI 자체는 **Bun**에서 실행됩니다(오늘날 모든 호스트와 동일) — CI나 개발 머신에서 `scriptcable build`를 실행하면, 생성된 클라이언트가 Deno/workerd에서 실행됩니다. 런타임에는 Bun이 필요 없습니다.

## 워치 모드

자체 워처가 없는 호스트(Turbopack predev 스크립트를 쓰는 Next.js, 일반 Bun/Node 앱)에서는:

```bash
scriptcable build --watch
```

빌드 캐시가 해시하는 것과 같은 입력 — 코어 엔트리와 같은 디렉터리의 형제 파일, 설정 파일 — 을 감시하고, 변경 시 재빌드합니다(코드젠과 `@scriptcable/client` 링크 포함). 오류로 감시가 멈추지 않습니다: 파일을 고치면 다시 빌드합니다.

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
