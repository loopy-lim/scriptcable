import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const CORE_TS = `/** scriptcable core — compiled by scriptc into a native library (default). */
export function add(a: number, b: number): number {
  return a + b;
}

export function mul(a: number, b: number): number {
  return a * b;
}

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

  const slugName = opts.name.replace(/[^A-Za-z0-9_-]/g, '-');
  const prefix = `${slug(opts.name)}_`;
  const config = {
    name: slugName,
    entry: 'src/core.ts',
    prefix,
    outDir: '.scriptcable',
    target: host === 'vite' ? 'both' : 'native',
    exports: [
      { name: 'add', params: ['f64', 'f64'], returns: 'f64' },
      { name: 'mul', params: ['f64', 'f64'], returns: 'f64' },
      { name: 'greet', params: ['string'], returns: 'string' },
    ],
  };
  await writeFile(join(root, 'scriptcable.json'), JSON.stringify(config, null, 2) + '\n');

  const deps: Record<string, string> = {
    scriptc: '^0.3.6',
    '@scriptcable/cli': '^0.1.0',
    '@scriptcable/core': '^0.1.0',
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
      `import { createNodeEngine } from '@scriptcable/node';

const engine = await createNodeEngine({ outDir: '.scriptcable' });
console.log(JSON.stringify({
  sum: engine.call('add', 20, 22),
  hi: engine.call('greet', '${host}'),
}));
engine.dispose?.();
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
  } else if (host === 'react-native' || host === 'lynx') {
    await writeFile(
      join(root, 'README.host.md'),
      `# ${host} host\n\n1. \`scriptcable build\`\n2. Link \`.scriptcable/lib${slugName}.a\` in your native module (iOS: Xcode, Android: CMake in the NDK project).\n3. Bridge JS with create${host === 'lynx' ? 'Lynx' : 'ReactNative'}Engine.\n`,
    );
  }

  await writeFile(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: opts.name,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts,
        engines: host === 'node' ? { node: '>=24' } : { bun: '>=1.2.0' },
        dependencies: deps,
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
    `# ${opts.name}\n\nscriptcable project (host: **${host}**, native default).\n\n\`\`\`bash\nbun install\nbunx scriptcable doctor\nbunx scriptcable build\n${scripts.start ? 'bun start' : 'bun run build'}\n\`\`\`\n\nMac (Apple Silicon): install clang via Xcode CLT; for iOS library archives see scriptc \`SCRIPTC_TARGET=aarch64-apple-ios\`.\n`,
  );

  console.log(`Created ${root} (host=${host})`);
  console.log(`  cd ${opts.name} && bun install && bunx scriptcable doctor && bunx scriptcable build`);
  return 0;
}

function slug(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '_').toLowerCase() || 'app';
}
