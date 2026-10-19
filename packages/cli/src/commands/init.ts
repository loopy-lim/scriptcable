import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const CORE_TS = `/** scriptca core — compiled by scriptc into WASM / native library. */
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

export async function runInit(opts: {
  name: string;
  cwd?: string;
  host?: string;
}): Promise<number> {
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

  const config = {
    name: opts.name.replace(/[^A-Za-z0-9_-]/g, '-'),
    entry: 'src/core.ts',
    prefix: `${slug(opts.name)}_`,
    outDir: '.scriptca',
    target: 'native',
    exports: [
      { name: 'add', params: ['f64', 'f64'], returns: 'f64' },
      { name: 'mul', params: ['f64', 'f64'], returns: 'f64' },
      { name: 'greet', params: ['string'], returns: 'string' },
    ],
  };
  await writeFile(join(root, 'scriptca.json'), JSON.stringify(config, null, 2) + '\n');

  await writeFile(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: opts.name,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          build: 'scriptca build',
          doctor: 'scriptca doctor',
          start: 'node --experimental-strip-types src/main.ts',
          'contract:check': 'scriptca diff --fail-on-breaking',
        },
        engines: { node: '>=24' },
        devDependencies: {
          scriptc: '^0.3.6',
          '@scriptc/runtime-wasm32-wasi': '^0.3.6',
          '@scriptca/cli': '^0.1.0',
          '@scriptca/core': '^0.1.0',
          '@scriptca/node': '^0.1.0',
        },
      },
      null,
      2,
    ) + '\n',
  );

  await writeFile(
    join(root, 'src', 'main.ts'),
    `import { createClient } from '../.scriptca/generated/node.ts';

const client = await createClient();
console.log('add', client.add(20, 22));
console.log('greet', client.greet('scriptca'));
client.dispose();
`,
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
    `# ${opts.name}

scriptca project — TypeScript core compiled by [scriptc](https://scriptc.dev).

## Setup

\`\`\`bash
# Node >= 24, zig 0.13.x on PATH
npm install
npx scriptca doctor
npx scriptca build
npm start
\`\`\`

Edit \`src/core.ts\` and \`scriptca.json\` exports, then rebuild.
`,
  );

  console.log(`Created ${root}`);
  console.log(`  cd ${opts.name} && npm install && npx scriptca build && npm start`);
  return 0;
}

function slug(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '_').toLowerCase() || 'app';
}
