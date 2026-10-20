import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { createMockBridge, createReactNativeEngine, createTurboModuleBridge } from '@scriptcable/react-native';

describe('rn example', () => {
  it('mock bridge', async () => {
    const engine = createReactNativeEngine(
      createMockBridge({
        add: (a, b) => Number(a) + Number(b),
        greet: (name) => `hello, ${name}`,
      }),
    );
    assert.equal(await engine.invoke('add', [1, 2]), 3);
    assert.equal(await engine.invoke('greet', ['rn']), 'hello, rn');
  });

  it('turbo-module bridge marshals JSON both ways', async () => {
    const fakeTurboModule = {
      async call(exportName: string, argsJson: string): Promise<string> {
        const args = JSON.parse(argsJson) as unknown[];
        if (exportName === 'add') return JSON.stringify({ ok: true, value: args[0]! as number + (args[1]! as number) });
        return JSON.stringify({ ok: false, error: `unknown ${exportName}` });
      },
    };
    const engine = createReactNativeEngine(createTurboModuleBridge(fakeTurboModule));
    assert.equal(await engine.invoke('add', [20, 22]), 42);
  });

  it('turbo-module bridge surfaces native errors', async () => {
    const failing = {
      async call(): Promise<string> {
        return JSON.stringify({ ok: false, error: 'core panicked' });
      },
    };
    const engine = createReactNativeEngine(createTurboModuleBridge(failing));
    try {
      await engine.invoke('add', [1, 2]);
      assert.fail('should have thrown');
    } catch (e) {
      assert.equal((e as { code?: string }).code, 'NATIVE_ERROR');
    }
  });

  it('profile validation rejects unknown exports', async () => {
    const engine = createReactNativeEngine(createMockBridge({ add: (a, b) => Number(a) + Number(b) }), {
      profile_format: 1,
      name: 'calc',
      entry: 'core.ts',
      emission: 'llvm',
      abi: { prefix: 'calc_', init_symbol: 'calc_init', sink_register_symbol: 'calc_sink' },
      exports: [{ export: 'add', symbol: 'calc_add', params: ['f64', 'f64'], returns: 'f64' }],
    });
    await assert.rejects(() => engine.invoke('nope', []), /Unknown export/);
  });
});
