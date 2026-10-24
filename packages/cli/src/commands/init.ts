import { mkdir, writeFile, access } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

const CORE_TS = `/**
 * scriptcable core — compiled by scriptc into a native library (default).
 *
 * Every exported function with ABI-mappable types (number, string, boolean,
 * Uint8Array, bigint, or aliases like \`type UserId = u32\`) becomes a native
 * export automatically. JSDoc comments flow into generated clients.
 */

/** Adds two numbers. */
export function add(a: number, b: number): number {
  return a + b;
}

/** Multiplies two numbers. */
export function mul(a: number, b: number): number {
  return a * b;
}

/** Greets someone by name. */
export function greet(name: string): string {
  return \`hello, \${name}\`;
}
`;

export type InitHost =
  | 'node'
  | 'bun'
  | 'vite'
  | 'next'
  | 'tauri'
  | 'react-native'
  | 'lynx';

export async function runInit(opts: {
  name: string;
  cwd?: string;
  host?: InitHost;
  /** Link @scriptcable/* to a local checkout via file: deps (pre-publish workflow) */
  from?: string;
}): Promise<number> {
  const host = opts.host ?? 'bun';
  const root = resolve(opts.cwd ?? process.cwd(), opts.name);
  try {
    await access(root);
    console.error(`Directory already exists: ${root}`);
    return 1;
  } catch {
    /* ok */
  }

  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'core.ts'), CORE_TS);

  // F-2: name은 경로 전체가 아니라 디렉터리 basename에서 — `/tmp/sc-perf-demo` → `sc-perf-demo`,
  // `.`(커런트 디렉터리 init)은 cwd 이름. 소문자+URL 안전 문자로 정규화(npm name 규칙), 비면 'app'.
  const dirName = basename(root);
  const slugName =
    dirName
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^[-_]+/, '')
      .replace(/[-_]+$/, '') || 'app';
  const prefix = `${slug(dirName)}_`;
  // Typed TS config — exports are inferred from src/core.ts, zero duplication.
  await writeFile(
    join(root, 'scriptcable.config.ts'),
    `import { defineConfig } from '@scriptcable/core';

/**
 * scriptcable config — fully typed.
 * Exports are inferred from ${'`'}src/core.ts${'`'} (ABI-mappable exported functions),
 * so you never duplicate signatures here. To pin explicitly, add:
 *   exports: [{ name: "add", params: ["f64", "f64"], returns: "f64" }]
 */
export default defineConfig({
  name: '${slugName}',
  entry: 'src/core.ts',
  prefix: '${prefix}',
  outDir: '.scriptcable',
  target: '${host === 'vite' ? 'both' : 'native'}',
});
`,
  );

  const deps: Record<string, string> = {
    scriptc: '^0.3.6',
    '@scriptcable/cli': '^0.1.0',
    '@scriptcable/core': '^0.1.0',
    // CI-durable client dep — the placeholder manifest written below lets
    // `bun install` resolve it before the first build; the first
    // `scriptcable build` overwrites the manifest with the real flavors.
    '@scriptcable/client': 'file:.scriptcable/generated',
  };
  const scripts: Record<string, string> = {
    build: 'scriptcable build',
    doctor: 'scriptcable doctor',
    'contract:check': 'scriptcable diff --fail-on-breaking',
  };

  if (host === 'bun' || host === 'node') {
    if (host === 'bun') {
      deps['@scriptcable/bun'] = '^0.1.0';
      deps['@scriptcable/node'] = '^0.1.0';
    } else {
      deps['@scriptcable/node'] = '^0.1.0';
      deps.koffi = '^3.3.3'; // optional Node-only FFI fallback (Bun has bun:ffi built in)
    }
    scripts.start = 'bun src/main.ts';
    await writeFile(
      join(root, 'src', 'main.ts'),
      `import { createClient } from '@scriptcable/client';

// Resolves through the node_modules link \`scriptcable build\` creates —
// no paths to know. Run \`scriptcable build\` first if it doesn't resolve.
const client = await createClient();
console.log(JSON.stringify({
  sum: client.add(20, 22),
  hi: client.greet('${host}'),
}));
client.dispose();
`,
    );
  } else if (host === 'vite') {
    deps['@scriptcable/vite'] = '^0.1.0';
    deps['@scriptc/runtime-wasm32-wasi'] = '^0.3.6';
    scripts.dev = 'scriptcable build --target both && vite';
    scripts['build:web'] = 'scriptcable build --target both && vite build';
    await writeFile(
      join(root, 'vite.config.ts'),
      `import { defineConfig } from 'vite';\nimport scriptcable from '@scriptcable/vite';\nexport default defineConfig({ plugins: [scriptcable()] });\n`,
    );
  } else if (host === 'next') {
    deps['@scriptcable/next'] = '^0.1.0';
    deps['@scriptcable/node'] = '^0.1.0';
    scripts['build:core'] = 'scriptcable build && bun -e "import(\'@scriptcable/next\').then(m=>m.scriptcableBuild())"';
  } else if (host === 'tauri') {
    await writeFile(
      join(root, 'README.host.md'),
      `# Tauri host\n\n1. \`scriptcable build\` → \`.scriptcable/lib${slugName}.a\`\n2. In the Tauri Rust app, link the archive via a build script (cc / build.rs) and expose \`#[tauri::command]\`s that call the C ABI symbols (\`${prefix}add\` etc.).\n3. Bridge from the webview with \`createTauriSidecarEngine\` (@scriptcable/tauri).\n`,
    );
  } else if (host === 'react-native') {
    deps['@scriptcable/react-native'] = '^0.1.0';
    scripts['build:core'] = 'scriptcable build --hosts react-native,node';
    await writeFile(
      join(root, 'src', 'useCable.ts'),
      `import { createReactNativeEngine, createTurboModuleBridge } from '@scriptcable/react-native';\n\n// NativeCable.ts is generated by \`scriptcable build --hosts react-native\`.\n// import NativeCable from '../.scriptcable/generated/NativeCable';\n\nexport function getCableEngine() {\n  return createReactNativeEngine(\n    createTurboModuleBridge(\n      // eslint-disable-next-line @typescript-eslint/no-var-requires\n      require('../.scriptcable/generated/NativeCable').default,\n    ),\n  );\n}\n`,
    );
    await writeFile(
      join(root, 'README.host.md'),
      `# React Native host (Expo or RN CLI)

## 1. Build the core
\`\`\`bash
bun run build:core   # → .scriptcable/generated/{react-native.ts,NativeCable.ts,cable.json} + lib${slugName}.a
\`\`\`

## 2. Expo (config plugin, recommended)
Add the library as an Expo module and link \`lib${slugName}.a\`:
\`\`\`bash
npx create-expo-module --local native-cable
\`\`\`
- iOS: drop \`.scriptcable/lib${slugName}.a\` into the module's Xcode project (or an XCFramework from \`SCRIPTC_TARGET=aarch64-apple-ios\`).
- Android: add the \`.a\` to \`android/build.gradle\` \`jniLibs\` / CMake external project.
- Implement \`call(exportName, argsJson) -> Promise<string>\` dispatching to \`${prefix}add\` etc.

## 3. Wire JS
\`\`\`ts
import { createTurboModuleBridge } from '@scriptcable/react-native';
import NativeCable from './NativeCable'; // generated spec
const engine = createReactNativeEngine(createTurboModuleBridge(NativeCable));
engine.invoke('add', [20, 22]); // 42
\`\`\`
Tests use \`createMockBridge\` — no device needed. See packages/react-native in the scriptcable repo.
`,
    );
  } else if (host === 'lynx') {
    await writeFile(
      join(root, 'README.host.md'),
      `# Lynx host\n\n1. \`scriptcable build\`\n2. Link \`.scriptcable/lib${slugName}.a\` in your native module (iOS: Xcode, Android: CMake in the NDK project).\n3. Bridge JS with createLynxEngine.\n`,
    );
  }

  // --from <checkout>: point every @scriptcable/* dep at the local checkout
  // (file:), so the scaffold works before the packages are published to npm.
  // The cli file: dep also links the `scriptcable` bin into node_modules/.bin.
  const overrides: Record<string, string> = {};
  if (opts.from) {
    const checkout = resolve(opts.from);
    // Every workspace package that a linked dep may reference via workspace:*
    // — root overrides force them all into the checkout so nested workspace:*
    // resolves outside the monorepo too.
    const allPkgs = [
      'cli', 'core', 'types', 'bun', 'node', 'vite', 'next', 'webpack',
      'tauri', 'react-native', 'lynx', 'testing',
    ];
    for (const pkg of allPkgs) {
      const target = join(checkout, 'packages', pkg);
      try {
        await access(target);
      } catch {
        continue;
      }
      overrides[`@scriptcable/${pkg}`] = `file:${relative(root, target)}`;
    }
    for (const [name, spec] of Object.entries(deps)) {
      if (!name.startsWith('@scriptcable/')) continue;
      // The client dep points at this project's generated dir, not the checkout
      if (name === '@scriptcable/client') continue;
      const fileSpec = overrides[name];
      if (!fileSpec) throw new Error(`--from: package not found in checkout: ${name}`);
      deps[name] = fileSpec;
    }
  }

  // Placeholder client package + gitignore negation: the only .scriptcable
  // content a fresh clone needs so `bun install` succeeds (bun fails a file:
  // dep whose target has no package.json) and the link survives re-installs.
  const genDir = join(root, '.scriptcable', 'generated');
  await mkdir(genDir, { recursive: true });
  await writeFile(
    join(genDir, 'package.json'),
    JSON.stringify(
      {
        name: '@scriptcable/client',
        version: '0.0.0-scriptcable',
        private: true,
        type: 'module',
        exports: { '.': './placeholder.ts' },
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    join(genDir, 'placeholder.ts'),
    `/* Placeholder — \`scriptcable build\` replaces this package with the generated flavors. */\nexport async function createClient(): Promise<never> {\n  throw new Error('@scriptcable/client is not built yet — run "scriptcable build" first.');\n}\n`,
  );
  await writeFile(
    join(root, '.gitignore'),
    [
      'node_modules/',
      '.scriptcable/*',
      '!.scriptcable/generated/',
      '.scriptcable/generated/*',
      '!.scriptcable/generated/package.json',
      '!.scriptcable/generated/placeholder.ts',
    ].join('\n') + '\n',
  );

  await writeFile(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: slugName,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts,
        engines: host === 'node' ? { node: '>=24' } : { bun: '>=1.2.0' },
        dependencies: deps,
        // scriptc needs an install script to fetch its binary — trust it up
        // front so `bun install` works without a prompt.
        ...(Object.keys(deps).includes('scriptc') ? { trustedDependencies: ['scriptc'] } : {}),
        ...(Object.keys(overrides).length ? { overrides } : {}),
      },
      null,
      2,
    ) + '\n',
  );

  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ['src/**/*', '.scriptcable/generated/**/*'],
      },
      null,
      2,
    ) + '\n',
  );

  await writeFile(
    join(root, 'README.md'),
    `# ${opts.name}\n\nscriptcable project (host: **${host}**, native default).\n\n\`\`\`bash\nbun install\nbun run doctor\nbun run build\n${scripts.start ? 'bun start' : 'bun run build'}\n\`\`\`\n\nMac (Apple Silicon): install clang via Xcode CLT; for iOS library archives see scriptc \`SCRIPTC_TARGET=aarch64-apple-ios\`.\n`,
  );

  console.log(`Created ${root} (host=${host})`);
  console.log(`  cd ${opts.name} && bun install && bun run doctor && bun run build`);
  return 0;
}

function slug(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '_').toLowerCase() || 'app';
}
