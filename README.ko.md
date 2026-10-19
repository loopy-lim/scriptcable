[English](./README.md) | Korean

# scriptca

하나의 **TypeScript** 코어 → **Node, Bun, Tauri, React Native, Lynx, Vite, Next.js**용 타입 안전 클라이언트.
[Vercel scriptc](https://scriptc.dev)가 **네이티브** 라이브러리(기본, `.lib.a` → `.so`)로 컴파일하고, WASM은 브라우저용 선택 사항이며, CI 계약이 깨지는 API 변경을 막습니다.

[rustra](https://github.com/loopy-lim/rustra)에서 영감을 받았습니다. Rust 코어 자리에 **scriptc**를 둡니다.

## 5분 퀵스타트

**필요:** Node.js ≥ 24와 `clang`(네이티브 공유 라이브러리 링크). WASM(`--target wasm`)을 쓸 때만 [zig 0.13.x](https://ziglang.org/download/).

```bash
pnpm --filter @scriptca/cli exec scriptca init my-app
cd my-app
npm install
npx scriptca doctor
npx scriptca build
npm start
```

`src/core.ts`와 `scriptca.json`의 exports를 수정한 뒤 다시 빌드하세요.

## 동작 방식

```
TypeScript 코어  →  scriptc 라이브러리 (WASM / .lib.a)  →  생성 클라이언트 + 어댑터
```

기본 산출물은 **네이티브**입니다. 브라우저처럼 네이티브를 쓸 수 없는 곳에서만 WASM을 선택하세요.

## 어댑터 퀵스타트

### Node

```bash
pnpm --filter @scriptca/example-calculator-core build
pnpm --filter @scriptca/example-node-app start
```

### Bun

```bash
pnpm --filter @scriptca/example-bun-app start
```

### Vite

```ts
import scriptca from '@scriptca/vite';
export default { plugins: [scriptca()] };
```

### Next.js / Turbopack

```js
import { withScriptca } from '@scriptca/next';
export default withScriptca({});
// Turbopack: predev에서 scriptcaBuild()
```

### Tauri / React Native / Lynx

README(영문)와 각 `examples/*/README.md`를 참고하세요. 이 환경에서 검증된 범위와 미검증 범위를 명시해 두었습니다.

## 계약 게이트

```bash
scriptca build
scriptca diff --fail-on-breaking
```

## 제한 (scriptc)

- 코어 TS는 [scriptc 지원 범위](https://scriptc.dev/docs/limitations) 안이어야 합니다.
- 기본 네이티브 빌드에는 **clang**이 필요합니다.
- WASM(`--target wasm`)에는 zig **0.13.x**와 (브라우저에서) WASI 폴리필이 필요합니다.

## 라이선스

MIT
