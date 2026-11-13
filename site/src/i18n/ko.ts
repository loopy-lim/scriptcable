import type { HostCategory } from './types';

/**
 * Korean dictionary — the source of truth for the `Dict` shape.
 * Every key here must exist in `en.ts` with the same structure.
 */
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
      compilerDetail: '한 코어 → 호스트별 클라이언트',
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
    sub: '이 사이트의 src/core.ts를 WASM으로 컴파일해 브라우저에서 실행합니다. 호출 한 번에 실을 작업이 많을수록 유리합니다.',
    badge: '브라우저 WASM',
    sourceTitle: 'src/core.ts',
    importNote: "import { mandelbrotRgba, boxBlurRgba, sumRange } from '../core'",
    run: '실행',
    running: '측정 중…',
    result: '결과',
    wasmTime: 'WASM',
    jsTime: '순수 JS',
    avgOf: '평균',
    callsUnit: '회',
    tabs: {
      mandelbrot: {
        label: 'mandelbrot',
        desc: '픽셀마다 수백 번의 반복 연산을 프레임 전체에 걸쳐 수행하고, 결과를 호출 한 번으로 돌려받습니다 — 굵은 호출의 대표 사례.',
        abi: '(w, h, cx, cy, scale, iter) → RGBA',
        code: `mandelbrotRgba(w, h, cx, cy, scale, maxIter)
// 픽셀당 최대 maxIter번의 z = z² + c 반복`,
        size: '크기 (128 / 256 / 512)',
        iter: '최대 반복 (32–1024)',
        presets: '프리셋',
        presetLabels: {
          home: '기본',
          seahorse: '해마 골짜기',
          elephant: '코끼리 골짜기',
          spiral: '삼중 나선',
        },
        reset: '처음으로',
        zoomHint: '캔버스를 클릭하면 그 지점으로 2× 확대됩니다.',
      },
      image: {
        label: 'image',
        desc: '이미지 버퍼를 한 번에 넘겨 필터를 돌립니다.',
        abi: 'RGBA → blur / resize / sobel',
        code: `grayscaleRgba(rgba)
boxBlurRgba(rgba, w, h)
resizeNearestRgba(rgba, w, h, w/2, h/2)
sobelRgba(rgba, w, h)`,
        size: '크기 (128 / 256 / 512)',
        filter: '필터',
        filterLabels: {
          grayscale: 'grayscale',
          blur: 'box blur',
          resize: 'resize ½',
          sobel: 'sobel',
        },
        before: '입력',
        after: '출력',
      },
      coarse: {
        label: 'sumRange',
        desc: '같은 합산을 N번 호출과 한 번 호출로 비교합니다.',
        abi: 'N×add vs 1×sumRange',
        code: `// N번 호출
let sum = 0;
for (let i = 0; i < n; i++) sum = add(sum, i);

// 한 번 호출
sumRange(n);`,
        n: 'n (1k–500k)',
        chattyLabel: 'WASM · N× add',
        chattyHint: 'N번',
        coarseLabel: 'WASM · sumRange',
        coarseHint: '1번',
        jsHint: 'JS',
        perOp: '원소당',
      },
      fib: {
        label: 'fib',
        desc: '반복 피보나치.',
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
      bytes: {
        label: 'sumBytes',
        desc: '버퍼를 한 번에 넘겨 합산합니다.',
        abi: '(bytes) → f64',
        code: `export function sumBytes(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return sum;
}`,
        size: '버퍼 크기',
      },
      add: {
        label: 'add',
        desc: '가벼운 숫자 더하기 — 호출 오버헤드가 상대적으로 커서 WASM이 느려 보일 수 있습니다.',
        abi: '(f64, f64) → f64',
        code: `export function add(a: number, b: number): number {
  return a + b;
}`,
        a: 'a',
        b: 'b',
      },
      repeat: {
        label: 'repeat',
        desc: '문자열을 넘나드는 호출 — 짧은 문자열을 자주 부르면 느립니다.',
        abi: '(utf8, f64) → utf8',
        code: `export function repeat(text: string, times: number): string {
  const parts: string[] = [];
  for (let i = 0; i < times; i++) parts.push(text);
  return parts.join(' / ');
}`,
        text: '텍스트',
        times: '반복 (1–12)',
      },
    },
    errorTitle: '데모 코어를 불러오지 못했습니다',
    errorBody: 'WASM 모듈 초기화에 실패했습니다. 콘솔을 확인하거나 다시 시도하세요.',
    retry: '다시 시도',
    loading: '데모 로딩 중',
  },
  hosts: {
    eyebrow: '호스트',
    title: '앱이 도는 곳 어디서나',
    sub: '번들러 플러그인 또는 export 조건으로 호스트별 클라이언트를 연결합니다.',
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
    sub: 'examples/bench-core 실측 (M1 Max / linux-x64).',
    tiles: [
      { value: '~24.5 ns', label: 'Node 애드온 · 호출당', tag: 'native' },
      { value: '~47 ns', label: 'Bun · 호출당', tag: 'native' },
      { value: '48 ns', label: '브라우저 WASM · 호출당', tag: 'wasm' },
      { value: '1.1 s → 166 ms', label: '콜드 → 웜 빌드 (6.4×)', tag: 'cache' },
    ],
    boundaryTitle: '호출 비용',
    boundaryColumns: { op: '연산', cost: '비용 (linux-x64)', note: '메모' },
    boundaryRows: [
      { op: 'number 호출', cost: '5–20 ns', note: '직접 바인딩 / 타입 애드온' },
      { op: 'string 왕복', cost: '~0.66–1.0 µs', note: '복사 + UTF-8' },
      { op: 'string 배치', cost: '−31%', note: 'batch()로 N개를 한 번에' },
      { op: '작은 string 다발', cost: '≈ 2× 지연', note: '묶거나 TS에 두기' },
    ],
    calloutTitle: '한 줄 요약',
    calloutBody: '호출 한 번에 할 일이 많을수록 컴파일된 코어가 유리합니다.',
    calloutPoints: [
      '숫자 루프·이미지·큰 버퍼는 네이티브/WASM에 맡기세요.',
      '짧은 문자열을 자주 부르면 batch()하거나 TS에 두세요.',
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

export default ko;
