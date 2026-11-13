import type { Dict } from './index';

/** English dictionary — must mirror every key in `ko.ts`. */
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
      compilerDetail: 'one core → per-host clients',
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
    sub: 'This site’s src/core.ts compiled to WASM, running in your browser. The more work each call carries, the more the compiled core pays off.',
    badge: 'browser WASM',
    sourceTitle: 'src/core.ts',
    importNote: "import { mandelbrotRgba, boxBlurRgba, sumRange } from '../core'",
    run: 'Run',
    running: 'measuring…',
    result: 'Result',
    wasmTime: 'WASM',
    jsTime: 'plain JS',
    avgOf: 'avg',
    callsUnit: 'calls',
    tabs: {
      mandelbrot: {
        label: 'mandelbrot',
        desc: 'Hundreds of iterations per pixel across a whole frame, returned by a single call — coarse-grained work, exactly what compiled cores are for.',
        abi: '(w, h, cx, cy, scale, iter) → RGBA',
        code: `mandelbrotRgba(w, h, cx, cy, scale, maxIter)
// up to maxIter z = z² + c iterations per pixel`,
        size: 'size (128 / 256 / 512)',
        iter: 'max iter (32–1024)',
        presets: 'presets',
        presetLabels: {
          home: 'home',
          seahorse: 'seahorse valley',
          elephant: 'elephant valley',
          spiral: 'triple spiral',
        },
        reset: 'reset',
        zoomHint: 'Click the canvas to zoom 2× into that point.',
      },
      image: {
        label: 'image',
        desc: 'Pass an image buffer once and run a filter.',
        abi: 'RGBA → blur / resize / sobel',
        code: `grayscaleRgba(rgba)
boxBlurRgba(rgba, w, h)
resizeNearestRgba(rgba, w, h, w/2, h/2)
sobelRgba(rgba, w, h)`,
        size: 'size (128 / 256 / 512)',
        filter: 'filter',
        filterLabels: {
          grayscale: 'grayscale',
          blur: 'box blur',
          resize: 'resize ½',
          sobel: 'sobel',
        },
        before: 'input',
        after: 'output',
      },
      coarse: {
        label: 'sumRange',
        desc: 'Same sum — N calls versus one call.',
        abi: 'N×add vs 1×sumRange',
        code: `// N calls
let sum = 0;
for (let i = 0; i < n; i++) sum = add(sum, i);

// one call
sumRange(n);`,
        n: 'n (1k–500k)',
        chattyLabel: 'WASM · N× add',
        chattyHint: 'N×',
        coarseLabel: 'WASM · sumRange',
        coarseHint: '1×',
        jsHint: 'JS',
        perOp: 'per element',
      },
      fib: {
        label: 'fib',
        desc: 'Iterative fibonacci.',
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
        desc: 'Pass the whole buffer once and sum inside.',
        abi: '(bytes) → f64',
        code: `export function sumBytes(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return sum;
}`,
        size: 'buffer size',
      },
      add: {
        label: 'add',
        desc: 'A tiny add — call overhead dominates, so WASM can look slower than plain JS.',
        abi: '(f64, f64) → f64',
        code: `export function add(a: number, b: number): number {
  return a + b;
}`,
        a: 'a',
        b: 'b',
      },
      repeat: {
        label: 'repeat',
        desc: 'String round-trips — many short strings get expensive.',
        abi: '(utf8, f64) → utf8',
        code: `export function repeat(text: string, times: number): string {
  const parts: string[] = [];
  for (let i = 0; i < times; i++) parts.push(text);
  return parts.join(' / ');
}`,
        text: 'text',
        times: 'times (1–12)',
      },
    },
    errorTitle: 'Could not load the demo core',
    errorBody: 'WASM module initialization failed. Check the console, or retry below.',
    retry: 'Retry',
    loading: 'Loading the demo',
  },
  hosts: {
    eyebrow: 'Hosts',
    title: 'Runs wherever your app runs',
    sub: 'Bundler plugins or export conditions wire the compiled client.',
    filters: [
      { id: 'all' as const, label: 'All (11)' },
      { id: 'dropin' as const, label: 'Bundler drop-in (6)' },
      { id: 'conditions' as const, label: 'Conditions path (4)' },
      { id: 'native' as const, label: 'Native runtime (1)' },
    ],
    columns: { host: 'Host', how: 'How it wires up', verified: 'Verified against' },
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
      { value: '~24.5 ns', label: 'Node addon · per call', tag: 'native' },
      { value: '~47 ns', label: 'Bun · per call', tag: 'native' },
      { value: '48 ns', label: 'browser WASM · per call', tag: 'wasm' },
      { value: '1.1 s → 166 ms', label: 'cold → warm build (6.4×)', tag: 'cache' },
    ],
    boundaryTitle: 'Call cost',
    boundaryColumns: { op: 'Operation', cost: 'Cost (linux-x64)', note: 'Note' },
    boundaryRows: [
      { op: 'number calls', cost: '5–20 ns', note: 'direct binding / typed addon' },
      { op: 'string round-trip', cost: '~0.66–1.0 µs', note: 'copy + UTF-8' },
      { op: 'string batch', cost: '−31%', note: 'batch() packs N into one call' },
      { op: 'many small strings', cost: '≈ 2× slower', note: 'batch or keep in TS' },
    ],
    calloutTitle: 'In short',
    calloutBody: 'Compiled cores win when each call carries real work.',
    calloutPoints: [
      'Number loops, images, and large buffers belong in native/WASM.',
      'For chatty short strings, use batch() or keep them in TS.',
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

export default en;
