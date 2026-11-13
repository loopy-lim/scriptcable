import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'ko';

const STORAGE_KEY = 'scriptcable-lang';

const ko = {
  meta: {
    title: 'scriptcable — 하나의 TypeScript 코어, 모든 런타임',
  },
  nav: {
    github: 'GitHub',
    docs: '문서',
    demo: '라이브 데모',
    langAria: '언어 전환 (현재: 한국어)',
    themeLightAria: '다크 모드 켜기',
    themeDarkAria: '라이트 모드 켜기',
  },
  hero: {
    eyebrow: 'Bun · Node · Deno · Tauri · React Native · Lynx · Workers · Vite · Next',
    title1: '하나의 TypeScript 코어.',
    title2: '모든 런타임.',
    sub: 'Vercel scriptc가 TypeScript 코드를 네이티브 라이브러리(.lib.a → .so/.dylib/.dll)로 컴파일하면, scriptcable이 모든 호스트를 위한 타입 안전 클라이언트를 생성합니다. 브라우저에서는 WASM을 선택합니다. CI 계약이 깨지는 API 변경을 차단합니다.',
    ctaPrimary: '시작하기',
    ctaSecondary: '라이브 데모 보기',
    quickstartLabel: '빠른 시작',
    quickstart: `bunx @unikit-bridge/scriptcable init demo --host bun
cd demo
bun install
bun run doctor && bun run build && bun start
# → {"sum":42,"hi":"hello, bun"}`,
    quickstartNote: '모든 명령을 예상 출력과 함께 엔드투엔드로 검증했습니다(docs/getting-started.md).',
  },
  demo: {
    eyebrow: '라이브 데모',
    title: '이 페이지 자체가 데모입니다',
    sub: '아래 호출들은 이 사이트의 src/core.ts를 scriptcable이 WebAssembly로 컴파일한 것입니다. 앱 코드는 평범한 import 그대로 두고, Vite 플러그인이 컴파일된 클라이언트로 교체합니다(드롭인).',
    badge: '브라우저에서 컴파일된 WASM 실행 중',
    run: '실행',
    result: '결과',
    wasmTime: '컴파일된 코어 (WASM)',
    jsTime: '동일 로직의 순수 JS',
    avgOf: '회 평균 · 직접 브라우저에서 측정',
    tabs: {
      add: { label: 'add', desc: '두 숫자를 더합니다(number 왕복).', a: 'a', b: 'b' },
      fib: { label: 'fib', desc: '반복 피보나치, 숫자 연산 왕복.', n: 'n (10–78)' },
      repeat: { label: 'repeat', desc: '문자열 결합, 경계를 넘는 string 왕복.', text: '텍스트', times: '반복 (1–12)' },
      bytes: { label: 'sumBytes', desc: '무작위 바이트 버퍼 합산, Uint8Array 마셜링.', size: '버퍼 크기 (바이트)' },
    },
    errorTitle: '데모 코어를 불러오지 못했습니다',
    errorBody: 'WASM 모듈 초기화에 실패했습니다. 콘솔을 확인하거나 아래 버튼으로 다시 시도하세요.',
    retry: '다시 시도',
    loading: '데모 코어 로딩 중',
  },
  hosts: {
    eyebrow: '호스트 매트릭스',
    title: '앱이 도는 곳 어디서나',
    sub: '번들러 플러그인은 import를 가로채 컴파일된 클라이언트로 연결합니다. 런타임 클라이언트는 export 조건으로 해석됩니다. 코드에는 분기가 없습니다.',
    columns: { host: '호스트', how: '연결 방식', verified: '검증 버전' },
    rows: [
      { host: 'Vite', how: '자동 드롭인, resolveId가 내장 리졸버보다 먼저 실행', verified: 'Vite 6 dev + build' },
      { host: 'Next.js (webpack)', how: '클라이언트 그래프는 브라우저 드롭인, 서버는 node 클라이언트', verified: 'Next 16.4.2' },
      { host: 'Next.js (Turbopack)', how: 'resolve 훅이 없어 export 조건 경로 사용', verified: 'Next 16.4.2' },
      { host: 'React Native / Expo', how: 'metro.config.js에 withScriptcableMetro()', verified: 'Metro 0.87 · RN 0.88 · Expo 58' },
      { host: 'Electron', how: '메인은 네이티브, 렌더러는 WASM 드롭인', verified: 'Electron 33 실물 런타임' },
      { host: 'Astro · SvelteKit · Nuxt · SolidStart', how: 'Vite 플러그인 등록 (@unikit-bridge/scriptcable/vite)', verified: 'Astro 5.18 · Nuxt 4.6 등' },
      { host: 'Bun · Node', how: '네이티브 공유 라이브러리, bun:ffi / 타입 N-API 애드온', verified: '실물 런타임 호출' },
      { host: 'Deno', how: 'deno 플레이버(컴파일된 .js)가 node보다 먼저 해석', verified: 'Deno 2.9' },
      { host: 'Cloudflare Workers', how: 'workerd 조건, wasm이 정적 CompiledWasm import로 탑재', verified: 'wrangler 4.151' },
      { host: 'Lynx (Rspeedy)', how: 'Rspack 리졸버에 JS 훅이 없어 조건 경로 사용', verified: 'Rspeedy 0.18.2' },
      { host: 'Rollup', how: '동일 플러그인, 표준 resolveId 훅', verified: 'rollup 4' },
    ],
  },
  bench: {
    eyebrow: '성능',
    title: '측정된 수치',
    sub: 'examples/bench-core의 벤치마크입니다. 헤드라인 수치는 M1 Max, 경계 비용은 linux-x64(2026-10-25) 실측이고, bench-gate가 커밋된 기준선과 비교해 수치를 검사합니다.',
    tiles: [
      { value: '~24.5 ns', label: '타입 N-API 애드온 (Node) · 호출당' },
      { value: '~47 ns', label: 'Bun (bun:ffi보다 앞섬) · 호출당' },
      { value: '48 ns', label: '브라우저 WASM · 호출당' },
      { value: '1.1 s → 166 ms', label: '콜드 → 웜 빌드 (6.4×)' },
    ],
    boundaryTitle: '경계를 넘는 비용',
    boundaryColumns: { op: '연산', cost: '비용 (linux-x64)', note: '메모' },
    boundaryRows: [
      { op: 'number 호출', cost: '5–20 ns', note: 'Bun fns / 타입 애드온' },
      { op: 'string 왕복', cost: '~0.66–1.0 µs', note: '복사 1회 + UTF-8 인/디코드' },
      { op: 'string 배치', cost: '−31%', note: 'client.batch()로 경계 1회에 N 호출' },
      { op: '작은 string 다발', cost: '≈ 2× 지연', note: 'TS보다 느립니다. 큰 단위의 export로 묶어 배치하거나 TS에 두세요' },
    ],
    boundaryNote: '컴파일된 코어는 경계 한 번으로 실제 일이 많을 때 이깁니다. 수학, 파싱, 메모리 격리가 그 예입니다.',
  },
  beforeAfter: {
    eyebrow: 'Before → After',
    title: '이제 하나만 알면 됩니다',
    sub: '예전에는 일곱 가지를 알아야 했습니다. 이제는 scriptcable build를 실행하거나, 이를 대신 실행하는 플러그인을 등록하는 것 하나면 충분합니다.',
    columns: { what: '알아야 했던 것', before: 'Before', now: 'Now' },
    rows: [
      { what: '설정 파일', before: 'scriptcable.config.ts 필수 (name, entry)', now: '선택 사항, package.json과 표준 위치에서 추론' },
      { what: '생성물 경로', before: '.scriptcable/generated/ 상대 import', now: '베어 지정자 하나, 또는 없음(드롭인)' },
      { what: '플레이버 선택', before: '호스트별 어댑터/파일 선택', now: '환경별 자동 (export 조건)' },
      { what: '브라우저 WASI', before: 'createMinimalWasi() 구성 후 전달', now: 'createClient() 인자 없음' },
      { what: '번들러 배선', before: '수동 alias/transpile (Next), JSON 전용 플러그인 설정', now: '플러그인이 전부 배선' },
      { what: '에디터 타입', before: '수동 tsconfig paths', now: '실제 패키지, 그대로 해석' },
      { what: '호출부', before: 'createClient() + 메서드 호출로 재작성', now: '그대로, ./core import가 컴파일 클라이언트로 리다이렉트' },
    ],
    codeTitle: '어느 런타임에서나 동일한 호출부',
    code: `// 변경 없는 앱 코드 — 플러그인이 이 import 뒤의 모듈을 교체합니다
import { add } from './src/core';
add(20, 22); // 42, 네이티브 애드온 속도`,
  },
  linux: {
    eyebrow: '검증 증거',
    title: '오늘 이 Linux에서 검증됨',
    sub: '2026-11-13, 이 저장소가 있는 linux-x64 머신에서 실제로 실행한 결과입니다. 스크린샷이 아니라 명령과 출력입니다.',
    rows: [
      { cmd: 'bun install && bun run build', out: '13개 패키지 + 조립된 @unikit-bridge/scriptcable 빌드 · exit 0' },
      { cmd: 'file libcalculator.so', out: 'ELF 64-bit LSB shared object, x86-64' },
      { cmd: 'calculator.node', out: '타입 N-API 애드온 · exports 3개 추론 · 계약 412b2913f2714496' },
      { cmd: 'bun start (bun-app)', out: '{"sum":42,"product":42,"hi":"hello, bun"}' },
      { cmd: 'node start (node-app)', out: '{"sum":42,"product":42,"hi":"hello, node"}' },
      { cmd: 'init demo → build → start', out: '{"sum":42,"hi":"hello, bun"} (신규 프로젝트 퀵스타트)' },
    ],
  },
  footer: {
    tagline: '하나의 TypeScript 코어, 모든 런타임.',
    links: { github: 'GitHub', npm: 'npm', docs: '문서', benchmarks: '벤치마크' },
    dogfood: '이 사이트도 scriptcable로 만들었습니다. 데모 코어는 scriptc가 WASM으로 컴파일한 src/core.ts이고, UI는 @unikit-bridge/ui를 썼습니다.',
    license: 'MIT License · Cloudflare Pages에서 배포',
  },
  common: {
    copy: '복사',
    copied: '복사됨',
  },
};

export type Dict = typeof ko;

const en: Dict = {
  meta: {
    title: 'scriptcable — one TypeScript core, every runtime',
  },
  nav: {
    github: 'GitHub',
    docs: 'Docs',
    demo: 'Live demo',
    langAria: 'Switch language (current: English)',
    themeLightAria: 'Switch to dark mode',
    themeDarkAria: 'Switch to light mode',
  },
  hero: {
    eyebrow: 'Bun · Node · Deno · Tauri · React Native · Lynx · Workers · Vite · Next',
    title1: 'One TypeScript core.',
    title2: 'Every runtime.',
    sub: 'Vercel scriptc compiles your TypeScript into a native library (.lib.a → .so/.dylib/.dll); scriptcable generates the type-safe client for every host. WASM is opt-in for browsers. CI contracts block breaking API changes.',
    ctaPrimary: 'Get started',
    ctaSecondary: 'Try the live demo',
    quickstartLabel: 'Quickstart',
    quickstart: `bunx @unikit-bridge/scriptcable init demo --host bun
cd demo
bun install
bun run doctor && bun run build && bun start
# → {"sum":42,"hi":"hello, bun"}`,
    quickstartNote: 'Every command is verified end-to-end with its expected output (docs/getting-started.md).',
  },
  demo: {
    eyebrow: 'Live demo',
    title: 'This page is the demo',
    sub: 'Every call below runs this site’s own src/core.ts, compiled to WebAssembly by scriptcable. The app code keeps its plain imports; the Vite plugin redirects them onto the compiled client (the drop-in).',
    badge: 'compiled WASM, running in your browser',
    run: 'Run',
    result: 'Result',
    wasmTime: 'compiled core (WASM)',
    jsTime: 'same logic in plain JS',
    avgOf: 'calls, averaged · measured in your browser',
    tabs: {
      add: { label: 'add', desc: 'Adds two numbers (a number round-trip).', a: 'a', b: 'b' },
      fib: { label: 'fib', desc: 'Iterative fibonacci, a number-crunching round-trip.', n: 'n (10–78)' },
      repeat: { label: 'repeat', desc: 'Joins copies of a string, a string round-trip over the boundary.', text: 'text', times: 'times (1–12)' },
      bytes: { label: 'sumBytes', desc: 'Sums a random byte buffer, Uint8Array marshaling.', size: 'buffer size (bytes)' },
    },
    errorTitle: 'Could not load the demo core',
    errorBody: 'WASM module initialization failed. Check the console, or retry below.',
    retry: 'Retry',
    loading: 'Loading the demo core',
  },
  hosts: {
    eyebrow: 'Host matrix',
    title: 'Runs wherever your app runs',
    sub: 'Bundler plugins intercept imports and wire the compiled client in. Runtime clients resolve through export conditions; no branching in your code.',
    columns: { host: 'Host', how: 'How interception wires up', verified: 'Verified against' },
    rows: [
      { host: 'Vite', how: 'automatic drop-in: resolveId runs before the builtin resolver', verified: 'Vite 6 dev + build' },
      { host: 'Next.js (webpack)', how: 'client graphs get the browser drop-in, server the node client', verified: 'Next 16.4.2' },
      { host: 'Next.js (Turbopack)', how: 'no resolve hook, conditions path', verified: 'Next 16.4.2' },
      { host: 'React Native / Expo', how: 'withScriptcableMetro() in metro.config.js', verified: 'Metro 0.87 · RN 0.88 · Expo 58' },
      { host: 'Electron', how: 'main runs native, renderer gets the WASM drop-in', verified: 'Electron 33 real runtime' },
      { host: 'Astro · SvelteKit · Nuxt · SolidStart', how: 'register the Vite plugin (@unikit-bridge/scriptcable/vite)', verified: 'Astro 5.18 · Nuxt 4.6 …' },
      { host: 'Bun · Node', how: 'native shared library: bun:ffi / typed N-API addon', verified: 'real runtime calls' },
      { host: 'Deno', how: 'deno flavor (compiled .js) resolves ahead of node', verified: 'Deno 2.9' },
      { host: 'Cloudflare Workers', how: 'workerd condition: wasm rides a static CompiledWasm import', verified: 'wrangler 4.151' },
      { host: 'Lynx (Rspeedy)', how: 'Rspack resolver has no JS hooks, conditions path', verified: 'Rspeedy 0.18.2' },
      { host: 'Rollup', how: 'same plugin: standard resolveId hook', verified: 'rollup 4' },
    ],
  },
  bench: {
    eyebrow: 'Performance',
    title: 'The numbers',
    sub: 'Benchmarks live in examples/bench-core: M1 Max headline numbers; boundary costs measured on linux-x64 (2026-10-25). A bench-gate guards both contracts against the committed baseline.',
    tiles: [
      { value: '~24.5 ns', label: 'typed N-API addon (Node) · per call' },
      { value: '~47 ns', label: 'Bun (still ahead of bun:ffi) · per call' },
      { value: '48 ns', label: 'browser WASM · per call' },
      { value: '1.1 s → 166 ms', label: 'cold → warm build (6.4×)' },
    ],
    boundaryTitle: 'What a crossing costs',
    boundaryColumns: { op: 'Operation', cost: 'Cost (linux-x64)', note: 'Note' },
    boundaryRows: [
      { op: 'number calls', cost: '5–20 ns', note: 'Bun fns / typed addon' },
      { op: 'string round-trip', cost: '~0.66–1.0 µs', note: 'one copy + UTF-8 encode/decode' },
      { op: 'string batch', cost: '−31%', note: 'client.batch(): N calls across one boundary' },
      { op: 'many small strings', cost: '≈ 2× slower', note: 'than plain TS; batch it or keep it in TS' },
    ],
    boundaryNote: 'Compiled cores win where one crossing does real work: math, parsing, memory isolation.',
  },
  beforeAfter: {
    eyebrow: 'Before → After',
    title: 'One thing to know',
    sub: 'Using scriptcable used to require seven pieces of knowledge; now it requires one: running scriptcable build, or registering a bundler plugin that runs it.',
    columns: { what: 'You had to know', before: 'Before', now: 'Now' },
    rows: [
      { what: 'Config file', before: 'scriptcable.config.ts required (name, entry)', now: 'optional, inferred from package.json + standard locations' },
      { what: 'Artifact paths', before: 'relative imports into .scriptcable/generated/', now: 'one bare specifier, or none at all (drop-in)' },
      { what: 'Flavor selection', before: 'per-host adapter/file choice', now: 'automatic per environment (export conditions)' },
      { what: 'Browser WASI adapter', before: 'construct & pass createMinimalWasi()', now: 'createClient() takes no args' },
      { what: 'Bundler wiring', before: 'manual alias/transpile (Next), JSON-only plugin config', now: 'plugins wire everything' },
      { what: 'Editor types', before: 'manual tsconfig paths', now: 'a real package, resolved as-is' },
      { what: 'Call sites', before: 'rewrite to createClient() + method calls', now: 'unchanged; ./core imports redirect onto the compiled client' },
    ],
    codeTitle: 'Identical call sites in every runtime',
    code: `// unchanged app code — the plugin swaps the module behind this import
import { add } from './src/core';
add(20, 22); // 42, native-addon speed`,
  },
  linux: {
    eyebrow: 'Verified evidence',
    title: 'Verified on this Linux, today',
    sub: 'Run on 2026-11-13 on the linux-x64 machine hosting this repository: commands and their actual output, not screenshots.',
    rows: [
      { cmd: 'bun install && bun run build', out: '13 packages + assembled @unikit-bridge/scriptcable built · exit 0' },
      { cmd: 'file libcalculator.so', out: 'ELF 64-bit LSB shared object, x86-64' },
      { cmd: 'calculator.node', out: 'typed N-API addon · 3 exports inferred · contract 412b2913f2714496' },
      { cmd: 'bun start (bun-app)', out: '{"sum":42,"product":42,"hi":"hello, bun"}' },
      { cmd: 'node start (node-app)', out: '{"sum":42,"product":42,"hi":"hello, node"}' },
      { cmd: 'init demo → build → start', out: '{"sum":42,"hi":"hello, bun"} (fresh-project quickstart)' },
    ],
  },
  footer: {
    tagline: 'One TypeScript core, every runtime.',
    links: { github: 'GitHub', npm: 'npm', docs: 'Docs', benchmarks: 'Benchmarks' },
    dogfood: 'This site eats its own dogfood: the demo core is src/core.ts compiled to WASM by scriptc, and the UI is built with @unikit-bridge/ui.',
    license: 'MIT License · deployed on Cloudflare Pages',
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
  if (!ctx) throw new Error('useI18n must be used inside <LangProvider>');
  return ctx;
}
