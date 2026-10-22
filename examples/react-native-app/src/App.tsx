/**
 * Example RN screen using the scriptcable core through useCable.
 * Copy this pattern into your Expo / RN CLI app.
 */
import React, { useEffect, useState } from 'react';
import { SafeAreaView, Text, Button } from 'react-native';
import { useCable } from './useCable';

export default function App() {
  const add = useCable('add');
  const greet = useCable('greet');
  const [sum, setSum] = useState<number | null>(null);
  const [hi, setHi] = useState('');

  useEffect(() => {
    greet('react-native').then(setHi).catch(console.error);
  }, [greet]);

  // Device assertion for the emulator CI — the NATIVE bridge only, no mock
  // fallback: the result (or the failure) is what logcat asserts on.
  // src/NativeCable.ts is the generated spec (wire-android.mjs copies it).
  // The TurboModule registry fills in shortly after first render on some
  // devices — retry a few times before reporting failure.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let attempt = 1; attempt <= 6 && !cancelled; attempt++) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const NativeCable = require('./NativeCable').default;
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { createTurboModuleBridge } = require('@scriptcable/react-native');
          // getEnforcing inside the spec throws when the native module is
          // absent — exactly what must fail loudly on a broken device build.
          const bridge = createTurboModuleBridge(NativeCable);
          const sum = await bridge.call('add', [20, 22]);
          console.log(`CABLE_RESULT:${JSON.stringify({ sum })}`);
          return;
        } catch (e) {
          const message = String(e);
          if (attempt === 6 || !/could not be found|not ready|not registered/i.test(message)) {
            console.log(`CABLE_RESULT:${JSON.stringify({ error: message })}`);
            return;
          }
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaView style={{ padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>scriptcable + React Native</Text>
      <Text>{hi}</Text>
      <Text>sum: {sum ?? '—'}</Text>
      <Button title="add(20, 22)" onPress={() => add(20, 22).then(setSum).catch(console.error)} />
    </SafeAreaView>
  );
}
