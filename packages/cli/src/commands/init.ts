import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const CORE_TS = `/** scriptca core — compiled by scriptc into a native library (default). */
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
  const host = opts.host ?? 'node';
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
    outDir: '.scriptca',
    target: host === 'vite' ? 'both' : 'native',
    exports: [
      { name: 'add', params: ['f64', 'f64'], returns: 'f64' },
      { name: 'mul', params: ['f64', 'f64'], returns: 'f64' },
      { name: 'greet', params: ['string'], returns: 'string' },
    ],
  };
  await writeFile(join(root, 'scriptca.json'), JSON.stringify(config, null, 2) + '\n');

  const deps: Record<string, string> = {
    scriptc: '^0.3.6',
    '@scriptca/cli': '^0.1.0',
    '@scriptca/core': '^0.1.0',
  };
  const scripts: Record<string, string> = {
    build: 'scriptca build',
    doctor: 'scriptca doctor',
    'contract:check': 'scriptca diff --fail-on-breaking',
  };

  if (host === 'node' || host === 'bun') {
    deps['@scriptca/node'] = '^0.1.0';
    deps.koffi = '^3.3.3';
    if (host === 'bun') deps['@scriptca/bun'] = '^0.1.0';
    scripts.start =
      host === 'bun'
        ? 'bun src/main.ts'
        : 'node --experimental-strip-types src/main.ts';
    await writeFile(
      join(root, 'src', 'main.ts'),
      `import { createNodeEngine } from '@scriptca/node';

const engine = await createNodeEngine({ outDir: '.scriptca' });
console.log(JSON.stringify({
  sum: engine.call('add', 20, 22),
  hi: engine.call('greet', '${host}'),
}));
engine.dispose?.();
`,
    );
  } else if (host === 'vite') {
    deps['@scriptca/vite'] = '^0.1.0';
    deps['@scriptc/runtime-wasm32-wasi'] = '^0.3.6';
    scripts.dev = 'scriptca build --target both && vite';
    scripts['build:web'] = 'scriptca build --target both && vite build';
    await writeFile(
      join(root, 'vite.config.ts'),
      `import { defineConfig } from 'vite';\nimport scriptca from '@scriptca/vite';\nexport default defineConfig({ plugins: [scriptca()] });\n`,
    );
  } else if (host === 'next') {
    deps['@scriptca/next'] = '^0.1.0';
    deps['@scriptca/node'] = '^0.1.0';
    deps.koffi = '^3.3.3';
    scripts['build:core'] = 'scriptca build && node -e "import(\'@scriptca/next\').then(m=>m.scriptcaBuild())"';
  } else if (host === 'tauri') {
    await writeFile(
      join(root, 'README.host.md'),
      `# Tauri host\n\n1. \`scriptca build\` → \`.scriptca/lib${slugName}.a\`\n2. Point \`SCRIPTCA_LIB_DIR\` at \`.scriptca\` and depend on \`scriptca-sys\` / \`scriptca-tauri\` from the scriptca repo (or vendor the crates).\n3. \`cargo test\` / wire \`#[tauri::command]\` to \`scriptca_add\` etc.\n`,
    );
  } else if (host === 'react-native' || host === 'lynx') {
    await writeFile(
      join(root, 'README.host.md'),
      `# ${host} host\n\n1. \`scriptca build\`\n2. Link \`.scriptca/lib${slugName}.a\` via CMake (see @scriptca/${host === 'lynx' ? 'lynx' : 'react-native'}/cpp).\n3. Bridge JS with create${host === 'lynx' ? 'Lynx' : 'ReactNative'}Engine.\n`,
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
        engines: { node: '>=24' },
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
        include: ['src/**/*', '.scriptca/generated/**/*'],
      },
      null,
      2,
    ) + '\n',
  );

  await writeFile(
    join(root, 'README.md'),
    `# ${opts.name}\n\nscriptca project (host: **${host}**, native default).\n\n\`\`\`bash\nnpm install\nnpx scriptca doctor\nnpx scriptca build\n${scripts.start ? 'npm start' : 'npm run build'}\n\`\`\`\n\nMac (Apple Silicon): install clang via Xcode CLT; for iOS library archives see scriptc \`SCRIPTC_TARGET=aarch64-apple-ios\`.\n`,
  );

  console.log(`Created ${root} (host=${host})`);
  console.log(`  cd ${opts.name} && npm install && npx scriptca doctor && npx scriptca build`);
  return 0;
}

function slug(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '_').toLowerCase() || 'app';
}
