import { useCallback, useState } from 'react';

import { Input, Label } from '@unikit-bridge/ui';

// Drop-in: this import keeps pointing at the TypeScript core — the vite
// plugin swaps the module behind it for the compiled WASM client.
import { sumBytes } from '../../core';
import { useI18n } from '../../i18n';
import { measurePair } from '../bench';
import { randomBytes } from '../canvas';
import { jsSumBytes } from '../jsTwins';
import { ResultView, RunButton, type Result } from '../ResultViews';

export function BytesPanel() {
  const { t } = useI18n();
  const [size, setSize] = useState('1024');
  const [result, setResult] = useState<Result | null>(null);

  const run = useCallback(() => {
    const n = Math.min(8192, Math.max(128, Math.floor(Number(size) || 1024)));
    setSize(String(n));
    const dataA = randomBytes(n);
    const dataB = randomBytes(n);
    const value = sumBytes(dataA).toLocaleString();
    const stats = measurePair(
      (iterations) => {
        let sum = 0;
        for (let i = 0; i < iterations; i++) sum += sumBytes((i & 1) === 0 ? dataA : dataB);
        return sum;
      },
      (iterations) => {
        let sum = 0;
        for (let i = 0; i < iterations; i++) sum += jsSumBytes((i & 1) === 0 ? dataA : dataB);
        return sum;
      },
      { minBatch: 1_000, maxBatch: 100_000 },
    );
    setResult({ value, ...stats });
  }, [size]);

  return (
    <div>
      <p className="text-sm text-muted-foreground">{t.demo.tabs.bytes.desc}</p>
      <div className="mt-4 grid gap-2">
        <Label nativeID="demo-bytes-size-label">{t.demo.tabs.bytes.size}</Label>
        <Input
          nativeID="demo-bytes-size"
          accessibilityLabelledBy="demo-bytes-size-label"
          value={size}
          onChangeText={setSize}
          inputMode="numeric"
          className="max-w-40 font-mono"
        />
      </div>
      <RunButton onRun={run} />
      {result ? <ResultView result={result} /> : null}
    </div>
  );
}
