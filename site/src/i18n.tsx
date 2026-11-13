import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'ko';
export type HostCategory = 'all' | 'dropin' | 'conditions' | 'native';

const STORAGE_KEY = 'scriptca-lang';

const ko = {
  meta: {
    title: 'scriptca — 하나의 TypeScript 코어, 모든 런타임',
  },
  nav: {
    demo: '데모',
    hosts: '호스트',
    bench: '성능',
    docs: '문서',
    github: 'GitHub',
    langAria: '언어 전환 (현재: 한국어)',
    themeLightAria: '다크 모드 켜기',
    themeDarkAria: '라이트 모드 켜기',
  },
  hero: {
    eyebrow: 'Bun · Node · Deno · Tauri · React Native · Lynx · Workers · Vite · Next',
    title1: '하나의 TypeScript 코어.',
    title2: '모든 런타임.',
    sub: 'scriptc로 TypeScript를 네이티브 라이브러리(.so/.dylib/.dll)와 WASM으로 컴파일하고, 모든 호스트에 맞는 타입 안전 클라이언트를 생성합니다.',
    ctaPrimary: '시작하기',
    ctaSecondary: '라이브 데모 보기',
    quickstartLabel: '빠른 시작',
    quickstart: `bunx @unikit-bridge/scriptca init demo --host bun
cd demo
bun install
bun run doctor && bun run build && bun start
# → {"sum":42,"hi":"hello, bun"}`,
    quickstartNote: 'docs/getting-started.md 기준 검증 완료.',
    router: {
      header: 'src/core.ts → 타깃 라우팅',
      badge: '1 core · N hosts',
      sourceLabel: '단일 입력 코어',
      sourceFile: 'src/core.ts',
      sourceCode: 'export function add(a: number, b: number): number',
      compilerLabel: 'scriptc + scriptca build',
      compilerDetail: 'ABI 추론 · 계약 해시 · 호스트별 클라이언트 생성',
      targetLabel: '타깃 호스트 선택',
      artifactLabel: '생성 산출물',
      wiringLabel: '연결 방식',
      callSiteLabel: '앱 호출부 (변경 없음)',
      callSiteCode: `import { add } from './src/core';
add(20, 22); // 42`,
      targets: [
        {
          id: 'bun-node',
          label: 'Bun / Node',
          kind: 'NATIVE',
          artifact: 'libcore.so · core.node',
          wiring: 'bun:ffi 또는 타입 N-API 애드온으로 직접 호출',
          note: '기본 출력은 네이티브 공유 라이브러리입니다.',
        },
        {
          id: 'browser',
          label: 'Vite / Next',
          kind: 'WASM DROP-IN',
          artifact: 'core.wasm · browser.ts',
          wiring: '플러그인 resolveId가 ./core import를 가로채 연결',
          note: '인자 없는 createClient()와 내장 최소 WASI 포함.',
        },
        {
          id: 'workers',
          label: 'Workers',
          kind: 'WORKERD',
          artifact: 'workers.ts · CompiledWasm',
          wiring: 'workerd export 조건으로 정적 WASM import 해석',
          note: 'fetch나 top-level await 없이 wrangler에서 즉시 로드.',
        },
        {
          id: 'mobile',
          label: 'RN / Expo',
          kind: 'BRIDGE',
          artifact: 'react-native.ts · libcore.a',
          wiring: 'metro.config.js의 withScriptcaMetro()가 브리지 연결',
          note: '네이티브 아카이브 링크 + JS 스레드 타입 안전 호출.',
        },
      ],
    },
  },
  demo: {
    eyebrow: '라이브 데모',
    title: '이 페이지 자체가 데모입니다',
    sub: '이 사이트의 src/core.ts를 WASM으로 컴파일해 실행합니다. 호출 코드는 일반 import 그대로입니다.',
    badge: '브라우저 WASM 실행 중',
    sourceTitle: 'src/core.ts',
    abiLabel: '추론 ABI',
    importNote: "import { add, fib, repeat, sumBytes } from '../core'",
    run: '실행',
    result: '실행 결과',
    wasmTime: '컴파일된 코어 (WASM)',
    jsTime: '동일 로직의 순수 JS',
    avgOf: '라운드 절사평균 · 워밍업 후 실측',
    callsUnit: '회',
    tabs: {
      add: {
        label: 'add',
        desc: '두 숫자를 더합니다(number 왕복).',
        abi: '(f64, f64) → f64',
        code: `export function add(a: number, b: number): number {
  return a + b;
}`,
        a: 'a',
        b: 'b',
      },
      fib: {
        label: 'fib',
        desc: '반복 피보나치, 숫자 연산 왕복.',
        abi: '(f64) → f64',
        code: `export function fib(n: number): number {
  let a = 0, b = 1;
  for (let i = 0; i < n; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return a;
}`,
        n: 'n (10–78)',
      },
      repeat: {
        label: 'repeat',
        desc: '문자열 결합, 경계를 넘는 string 왕복.',
        abi: '(utf8, f64) → utf8',
        code: `export function repeat(text: string, times: number): string {
  const parts: string[] = [];
  for (let i = 0; i < times; i++) parts.push(text);
  return parts.join(' / ');
}`,
        text: '텍스트',
        times: '반복 (1–12)',
      },
      bytes: {
        label: 'sumBytes',
        desc: '무작위 바이트 버퍼 합산, Uint8Array 마셜링.',
        abi: '(bytes) → f64',
        code: `export function sumBytes(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return sum;
}`,
        size: '버퍼 크기 (바이트)',
      },
    },
    errorTitle: '데모 코어를 불러오지 못했습니다',
    errorBody: 'WASM 모듈 초기화에 실패했습니다. 콘솔을 확인하거나 아래 버튼으로 다시 시도하세요.',
    retry: '다시 시도',
    loading: '데모 코어 로딩 중',
  },
  hosts: {
    eyebrow: '호스트 매트릭스',
    title: '앱이 도는 곳 어디서나',
    sub: '번들러 플러그인 또는 패키지 export 조건으로 호스트별 클라이언트를 자동 연결합니다.',
    filters: [
      { id: 'all' as HostCategory, label: '전체 (11)' },
      { id: 'dropin' as HostCategory, label: '번들러 드롭인 (6)' },
      { id: 'conditions' as HostCategory, label: '조건 경로 (4)' },
      { id: 'native' as HostCategory, label: '네이티브 런타임 (1)' },
    ],
    columns: { host: '호스트', how: '연결 방식', verified: '검증 버전' },
    rows: [
      { host: 'Vite', category: 'dropin' as const, how: '자동 드롭인, resolveId가 내장 리졸버보다 먼저 실행', verified: 'Vite 6 dev + build' },
      { host: 'Next.js (webpack)', category: 'dropin' as const, how: '클라이언트 그래프는 브라우저 드롭인, 서버는 node 클라이언트', verified: 'Next 16.4.2' },
      { host: 'Next.js (Turbopack)', category: 'conditions' as const, how: 'resolve 훅이 없어 export 조건 경로 사용', verified: 'Next 16.4.2' },
      { host: 'React Native / Expo', category: 'dropin' as const, how: 'metro.config.js에 withScriptcaMetro()', verified: 'Metro 0.87 · RN 0.88 · Expo 58' },
      { host: 'Electron', category: 'dropin' as const, how: '메인은 네이티브, 렌더러는 WASM 드롭인', verified: 'Electron 33 실물 런타임' },
      { host: 'Astro · SvelteKit · Nuxt · SolidStart', category: 'dropin' as const, how: 'Vite 플러그인 등록 (@unikit-bridge/scriptca/vite)', verified: 'Astro 5.18 · Nuxt 4.6 등' },
      { host: 'Bun · Node', category: 'native' as const, how: '네이티브 공유 라이브러리, bun:ffi / 타입 N-API 애드온', verified: '실물 런타임 호출' },
      { host: 'Deno', category: 'conditions' as const, how: 'deno 플레이버(컴파일된 .js)가 node보다 먼저 해석', verified: 'Deno 2.9' },
      { host: 'Cloudflare Workers', category: 'conditions' as const, how: 'workerd 조건, wasm이 정적 CompiledWasm import로 탑재', verified: 'wrangler 4.151' },
      { host: 'Lynx (Rspeedy)', category: 'conditions' as const, how: 'Rspack 리졸버에 JS 훅이 없어 조건 경로 사용', verified: 'Rspeedy 0.18.2' },
      { host: 'Rollup', category: 'dropin' as const, how: '동일 플러그인, 표준 resolveId 훅', verified: 'rollup 4' },
    ],
  },
  bench: {
    eyebrow: '성능',
    title: '측정된 수치',
    sub: 'examples/bench-core 실측 수치 (M1 Max / linux-x64).',
    tiles: [
      { value: '~24.5 ns', label: '타입 N-API 애드온 (Node) · 호출당', tag: 'native' },
      { value: '~47 ns', label: 'Bun (bun:ffi보다 앞섬) · 호출당', tag: 'native' },
      { value: '48 ns', label: '브라우저 WASM · 호출당', tag: 'wasm' },
      { value: '1.1 s → 166 ms', label: '콜드 → 웜 빌드 (6.4×)', tag: 'cache' },
    ],
    boundaryTitle: '경계를 넘는 비용',
    boundaryColumns: { op: '연산', cost: '비용 (linux-x64)', note: '메모' },
    boundaryRows: [
      { op: 'number 호출', cost: '5–20 ns', note: 'Bun fns / 타입 애드온' },
      { op: 'string 왕복', cost: '~0.66–1.0 µs', note: '복사 1회 + UTF-8 인/디코드' },
      { op: 'string 배치', cost: '−31%', note: 'client.batch()로 경계 1회에 N 호출' },
      { op: '작은 string 다발', cost: '≈ 2× 지연', note: '큰 단위로 묶거나 TS에 두는 편이 유리' },
    ],
    calloutTitle: '경계 설계 기준',
    calloutBody: '경계 한 번에 충분한 연산을 태울 때 유리합니다.',
    calloutPoints: [
      '숫자 루프·버퍼·굵은 export는 네이티브/WASM 속도 그대로.',
      '짧은 문자열 반복은 client.batch() 또는 TS 유지.',
    ],
  },
  beforeAfter: {
    eyebrow: 'Before → After',
    title: '이제 하나만 알면 됩니다',
    sub: 'scriptca build 또는 번들러 플러그인 등록 하나면 충분합니다.',
    columns: { what: '알아야 했던 것', before: 'Before', now: 'Now' },
    rows: [
      { what: '설정 파일', before: 'scriptca.config.ts 필수 (name, entry)', now: '선택 사항, package.json과 표준 위치에서 추론' },
      { what: '생성물 경로', before: '.scriptca/generated/ 상대 import', now: '베어 지정자 하나, 또는 없음(드롭인)' },
      { what: '플레이버 선택', before: '호스트별 어댑터/파일 선택', now: '환경별 자동 (export 조건)' },
      { what: '브라우저 WASI', before: 'createMinimalWasi() 구성 후 전달', now: 'createClient() 인자 없음' },
      { what: '번들러 배선', before: '수동 alias/transpile (Next), JSON 전용 플러그인 설정', now: '플러그인이 전부 배선' },
      { what: '에디터 타입', before: '수동 tsconfig paths', now: '실제 패키지, 그대로 해석' },
      { what: '호출부', before: 'createClient() + 메서드 호출로 재작성', now: '그대로, ./core import가 컴파일 클라이언트로 리다이렉트' },
    ],
    beforeCodeTitle: '이전: 호스트별 수동 배선',
    beforeCode: `// 호스트마다 다른 어댑터·경로·WASI 인자 필요
const engine = await createNodeEngine({ outDir: '.scriptca' });
engine.call('add', 20, 22);`,
    codeTitle: '현재: 어느 런타임에서나 동일한 호출부',
    code: `// 변경 없는 앱 코드 — 플러그인이 이 import 뒤의 모듈을 교체합니다
import { add } from './src/core';
add(20, 22); // 42, 네이티브 애드온 속도`,
  },
  linux: {
    eyebrow: '검증 증거',
    title: '오늘 이 Linux에서 검증됨',
    sub: '2026-11-13 linux-x64 실제 실행 로그.',
    headerMeta: 'linux-x64 · 6개 검증 통과 · exit 0',
    rows: [
      { cmd: 'bun install && bun run build', out: '13개 패키지 + @unikit-bridge/scriptca 빌드 · exit 0' },
      { cmd: 'file libcalculator.so', out: 'ELF 64-bit LSB shared object, x86-64' },
      { cmd: 'calculator.node', out: '타입 N-API 애드온 · exports 3개 추론 · 계약 412b2913f2714496' },
      { cmd: 'bun start (bun-app)', out: '{"sum":42,"product":42,"hi":"hello, bun"}' },
      { cmd: 'node start (node-app)', out: '{"sum":42,"product":42,"hi":"hello, node"}' },
      { cmd: 'init demo → build → start', out: '{"sum":42,"hi":"hello, bun"}' },
    ],
  },
  footer: {
    tagline: '하나의 TypeScript 코어, 모든 런타임.',
    links: { github: 'GitHub', npm: 'npm', docs: '문서', benchmarks: '벤치마크' },
    license: 'MIT License',
  },
  common: {
    copy: '복사',
    copied: '복사됨',
  },
};

export type Dict = typeof ko;

const en: Dict = {
  meta: {
    title: 'scriptca — one TypeScript core, every runtime',
  },
  nav: {
    demo: 'Demo',
    hosts: 'Hosts',
    bench: 'Benchmarks',
    docs: 'Docs',
    github: 'GitHub',
    langAria: 'Switch language (current: English)',
    themeLightAria: 'Switch to dark mode',
    themeDarkAria: 'Switch to light mode',
  },
  hero: {
    eyebrow: 'Bun · Node · Deno · Tauri · React Native · Lynx · Workers · Vite · Next',
    title1: 'One TypeScript core.',
    title2: 'Every runtime.',
    sub: 'scriptc compiles TypeScript into native libraries (.so/.dylib/.dll) and WASM; scriptca emits type-safe clients for every host.',
    ctaPrimary: 'Get started',
    ctaSecondary: 'Try the live demo',
    quickstartLabel: 'Quickstart',
    quickstart: `bunx @unikit-bridge/scriptca init demo --host bun
cd demo
bun install
bun run doctor && bun run build && bun start
# → {"sum":42,"hi":"hello, bun"}`,
    quickstartNote: 'Verified end-to-end against docs/getting-started.md.',
    router: {
      header: 'src/core.ts → target routing',
      badge: '1 core · N hosts',
      sourceLabel: 'Single input core',
      sourceFile: 'src/core.ts',
      sourceCode: 'export function add(a: number, b: number): number',
      compilerLabel: 'scriptc + scriptca build',
      compilerDetail: 'ABI inferred · contract hash · per-host client emit',
      targetLabel: 'Select target host',
      artifactLabel: 'Emitted artifact',
      wiringLabel: 'Resolution',
      callSiteLabel: 'App call site (unchanged)',
      callSiteCode: `import { add } from './src/core';
add(20, 22); // 42`,
      targets: [
        {
          id: 'bun-node',
          label: 'Bun / Node',
          kind: 'NATIVE',
          artifact: 'libcore.so · core.node',
          wiring: 'Direct native call via bun:ffi or typed N-API addon',
          note: 'Default artifact is a native shared library.',
        },
        {
          id: 'browser',
          label: 'Vite / Next',
          kind: 'WASM DROP-IN',
          artifact: 'core.wasm · browser.ts',
          wiring: 'Plugin resolveId intercepts ./core imports automatically',
          note: 'Includes minimal WASI polyfill; createClient() takes no args.',
        },
        {
          id: 'workers',
          label: 'Workers',
          kind: 'WORKERD',
          artifact: 'workers.ts · CompiledWasm',
          wiring: 'workerd export condition resolves static WASM import',
          note: 'Runs in wrangler with zero fetch and no top-level await.',
        },
        {
          id: 'mobile',
          label: 'RN / Expo',
          kind: 'BRIDGE',
          artifact: 'react-native.ts · libcore.a',
          wiring: 'withScriptcaMetro() in metro.config.js wires the bridge',
          note: 'Links native archive; type-safe calls from JS.',
        },
      ],
    },
  },
  demo: {
    eyebrow: 'Live demo',
    title: 'This page is the demo',
    sub: 'Compiles this site’s src/core.ts to WASM and runs it directly. App code keeps plain imports.',
    badge: 'running compiled WASM',
    sourceTitle: 'src/core.ts',
    abiLabel: 'Inferred ABI',
    importNote: "import { add, fib, repeat, sumBytes } from '../core'",
    run: 'Run',
    result: 'Result',
    wasmTime: 'compiled core (WASM)',
    jsTime: 'same logic in plain JS',
    avgOf: 'round trimmed mean · warmed',
    callsUnit: 'calls',
    tabs: {
      add: {
        label: 'add',
        desc: 'Adds two numbers (a number round-trip).',
        abi: '(f64, f64) → f64',
        code: `export function add(a: number, b: number): number {
  return a + b;
}`,
        a: 'a',
        b: 'b',
      },
      fib: {
        label: 'fib',
        desc: 'Iterative fibonacci, a number-crunching round-trip.',
        abi: '(f64) → f64',
        code: `export function fib(n: number): number {
  let a = 0, b = 1;
  for (let i = 0; i < n; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return a;
}`,
        n: 'n (10–78)',
      },
      repeat: {
        label: 'repeat',
        desc: 'Joins copies of a string, a string round-trip over the boundary.',
        abi: '(utf8, f64) → utf8',
        code: `export function repeat(text: string, times: number): string {
  const parts: string[] = [];
  for (let i = 0; i < times; i++) parts.push(text);
  return parts.join(' / ');
}`,
        text: 'text',
        times: 'times (1–12)',
      },
      bytes: {
        label: 'sumBytes',
        desc: 'Sums a random byte buffer, Uint8Array marshaling.',
        abi: '(bytes) → f64',
        code: `export function sumBytes(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return sum;
}`,
        size: 'buffer size (bytes)',
      },
    },
    errorTitle: 'Could not load the demo core',
    errorBody: 'WASM module initialization failed. Check the console, or retry below.',
    retry: 'Retry',
    loading: 'Loading the demo core',
  },
  hosts: {
    eyebrow: 'Host matrix',
    title: 'Runs wherever your app runs',
    sub: 'Bundler plugins or package export conditions wire the compiled client automatically.',
    filters: [
      { id: 'all' as HostCategory, label: 'All (11)' },
      { id: 'dropin' as HostCategory, label: 'Bundler drop-in (6)' },
      { id: 'conditions' as HostCategory, label: 'Conditions path (4)' },
      { id: 'native' as HostCategory, label: 'Native runtime (1)' },
    ],
    columns: { host: 'Host', how: 'How interception wires up', verified: 'Verified against' },
    rows: [
      { host: 'Vite', category: 'dropin' as const, how: 'automatic drop-in: resolveId runs before the builtin resolver', verified: 'Vite 6 dev + build' },
      { host: 'Next.js (webpack)', category: 'dropin' as const, how: 'client graphs get the browser drop-in, server the node client', verified: 'Next 16.4.2' },
      { host: 'Next.js (Turbopack)', category: 'conditions' as const, how: 'no resolve hook, conditions path', verified: 'Next 16.4.2' },
      { host: 'React Native / Expo', category: 'dropin' as const, how: 'withScriptcaMetro() in metro.config.js', verified: 'Metro 0.87 · RN 0.88 · Expo 58' },
      { host: 'Electron', category: 'dropin' as const, how: 'main runs native, renderer gets the WASM drop-in', verified: 'Electron 33 real runtime' },
      { host: 'Astro · SvelteKit · Nuxt · SolidStart', category: 'dropin' as const, how: 'register the Vite plugin (@unikit-bridge/scriptca/vite)', verified: 'Astro 5.18 · Nuxt 4.6 …' },
      { host: 'Bun · Node', category: 'native' as const, how: 'native shared library: bun:ffi / typed N-API addon', verified: 'real runtime calls' },
      { host: 'Deno', category: 'conditions' as const, how: 'deno flavor (compiled .js) resolves ahead of node', verified: 'Deno 2.9' },
      { host: 'Cloudflare Workers', category: 'conditions' as const, how: 'workerd condition: wasm rides a static CompiledWasm import', verified: 'wrangler 4.151' },
      { host: 'Lynx (Rspeedy)', category: 'conditions' as const, how: 'Rspack resolver has no JS hooks, conditions path', verified: 'Rspeedy 0.18.2' },
      { host: 'Rollup', category: 'dropin' as const, how: 'same plugin: standard resolveId hook', verified: 'rollup 4' },
    ],
  },
  bench: {
    eyebrow: 'Performance',
    title: 'The numbers',
    sub: 'Measured in examples/bench-core (M1 Max / linux-x64).',
    tiles: [
      { value: '~24.5 ns', label: 'typed N-API addon (Node) · per call', tag: 'native' },
      { value: '~47 ns', label: 'Bun (still ahead of bun:ffi) · per call', tag: 'native' },
      { value: '48 ns', label: 'browser WASM · per call', tag: 'wasm' },
      { value: '1.1 s → 166 ms', label: 'cold → warm build (6.4×)', tag: 'cache' },
    ],
    boundaryTitle: 'What a crossing costs',
    boundaryColumns: { op: 'Operation', cost: 'Cost (linux-x64)', note: 'Note' },
    boundaryRows: [
      { op: 'number calls', cost: '5–20 ns', note: 'Bun fns / typed addon' },
      { op: 'string round-trip', cost: '~0.66–1.0 µs', note: 'one copy + UTF-8 encode/decode' },
      { op: 'string batch', cost: '−31%', note: 'client.batch(): N calls across one boundary' },
      { op: 'many small strings', cost: '≈ 2× slower', note: 'batch coarse work or keep in TS' },
    ],
    calloutTitle: 'Boundary rule of thumb',
    calloutBody: 'Compiled cores win when each crossing carries real work.',
    calloutPoints: [
      'Number loops, byte buffers, and coarse exports run at full native/WASM speed.',
      'For chatty small strings, group with client.batch() or keep in TS.',
    ],
  },
  beforeAfter: {
    eyebrow: 'Before → After',
    title: 'One thing to know',
    sub: 'Run scriptca build, or register a bundler plugin that runs it.',
    columns: { what: 'You had to know', before: 'Before', now: 'Now' },
    rows: [
      { what: 'Config file', before: 'scriptca.config.ts required (name, entry)', now: 'optional, inferred from package.json + standard locations' },
      { what: 'Artifact paths', before: 'relative imports into .scriptca/generated/', now: 'one bare specifier, or none at all (drop-in)' },
      { what: 'Flavor selection', before: 'per-host adapter/file choice', now: 'automatic per environment (export conditions)' },
      { what: 'Browser WASI adapter', before: 'construct & pass createMinimalWasi()', now: 'createClient() takes no args' },
      { what: 'Bundler wiring', before: 'manual alias/transpile (Next), JSON-only plugin config', now: 'plugins wire everything' },
      { what: 'Editor types', before: 'manual tsconfig paths', now: 'a real package, resolved as-is' },
      { what: 'Call sites', before: 'rewrite to createClient() + method calls', now: 'unchanged; ./core imports redirect onto the compiled client' },
    ],
    beforeCodeTitle: 'Before: manual per-host wiring',
    beforeCode: `// per-host imports, paths, and WASI adapters
const engine = await createNodeEngine({ outDir: '.scriptca' });
engine.call('add', 20, 22);`,
    codeTitle: 'Now: identical call sites in every runtime',
    code: `// unchanged app code — the plugin swaps the module behind this import
import { add } from './src/core';
add(20, 22); // 42, native-addon speed`,
  },
  linux: {
    eyebrow: 'Verified evidence',
    title: 'Verified on this Linux, today',
    sub: '2026-11-13 linux-x64 live command log.',
    headerMeta: 'linux-x64 · 6 checks passed · exit 0',
    rows: [
      { cmd: 'bun install && bun run build', out: '13 packages + @unikit-bridge/scriptca built · exit 0' },
      { cmd: 'file libcalculator.so', out: 'ELF 64-bit LSB shared object, x86-64' },
      { cmd: 'calculator.node', out: 'typed N-API addon · 3 exports inferred · contract 412b2913f2714496' },
      { cmd: 'bun start (bun-app)', out: '{"sum":42,"product":42,"hi":"hello, bun"}' },
      { cmd: 'node start (node-app)', out: '{"sum":42,"product":42,"hi":"hello, node"}' },
      { cmd: 'init demo → build → start', out: '{"sum":42,"hi":"hello, bun"}' },
    ],
  },
  footer: {
    tagline: 'One TypeScript core, every runtime.',
    links: { github: 'GitHub', npm: 'npm', docs: 'Docs', benchmarks: 'Benchmarks' },
    license: 'MIT License',
  },
  common: {
    copy: 'Copy',
    copied: 'Copied',
  },
};

const dict: Record<Lang, Dict> = { ko, en };

type I18nContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Dict;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ko' || saved === 'en') return saved;
    return navigator.language.startsWith('ko') ? 'ko' : 'en';
  } catch {
    return 'ko';
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage unavailable — in-memory only */
    }
    document.documentElement.lang = lang;
    document.title = dict[lang].meta.title;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t: dict[lang] }}>{children}</I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside LangProvider');
  return ctx;
}
