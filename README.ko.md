[English](./README.md) | Korean

# scriptcable

하나의 **TypeScript** 코어 → **Bun, Node, Tauri, React Native, Lynx, Vite, Next.js**용 타입 안전 클라이언트.
[Vercel scriptc](https://scriptc.dev)가 **네이티브** 라이브러리(기본, `.lib.a` → `.so`/`.dylib`/`.dll`)로 컴파일하고, WASM은 브라우저용 선택 사항이며, CI 계약이 깨지는 API 변경을 막습니다.

[rustra](https://github.com/loopy-lim/rustra)에서 영감을 받았습니다. Rust 코어 자리에 **scriptc**를 두고, 도구와 앱 전부를 **Bun**으로 실행합니다.

## 5분 퀵스타트

**필요:** Bun ≥ 1.2와 `clang`(네이티브 공유 라이브러리 링크). WASM(`--target wasm`)을 쓸 때만 [zig 0.13.x](https://ziglang.org/download/).

```bash
bun run --filter @scriptcable/cli exec scriptcable init my-app
cd my-app
bun install
bunx scriptcable doctor
bunx scriptcable build
bun start
```

`src/core.ts`와 `scriptcable.json`의 exports를 수정한 뒤 다시 빌드하세요.

## 동작 방식

```
TypeScript 코어  →  scriptc 라이브러리 (WASM / .lib.a)  →  생성 클라이언트 + 어댑터
```

기본 산출물은 **네이티브**입니다. 브라우저처럼 네이티브를 쓸 수 없는 곳에서만 WASM을 선택하세요.

Bun은 **bun:ffi**(내장)로 공유 라이브러리를 로드합니다. 순수 Node에서는 `koffi`를 선택적 폴백으로 설치할 수 있습니다.

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
import { withScriptca } from '@scriptcable/next';
export default withScriptca({});
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
