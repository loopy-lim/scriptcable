import { useCallback, useState } from 'react';

import { Input, Label } from '@unikit-bridge/ui';

// Drop-in: this import keeps pointing at the TypeScript core — the vite
// plugin swaps the module behind it for the compiled WASM client.
import { fib } from '../../core';
import { useI18n } from '../../i18n';
import { measurePair } from '../bench';
import { jsFib } from '../jsTwins';
import { ResultView, RunButton, type Result } from '../ResultViews';

export function FibPanel() {
  const { t } = useI18n();
  const [n, setN] = useState('40');
  const [result, setResult] = useState<Result | null>(null);

  const run = useCallback(() => {
    // Upper bound 78: f64 (the ABI type for number) is exact only up to
    // fib(78) = MAX_SAFE_INTEGER — beyond that the displayed value would
    // silently lose precision.
    const x = Math.min(78, Math.max(10, Math.floor(Number(n) || 40)));
    setN(String(x));
    const alt = Math.max(10, x - 1);
    const value = fib(x).toLocaleString();
    const stats = measurePair(
      (count) => {
        let sum = 0;
        for (let i = 0; i < count; i++) sum += fib((i & 1) === 0 ? x : alt);
        return sum;
      },
      (count) => {
        let sum = 0;
        for (let i = 0; i < count; i++) sum += jsFib((i & 1) === 0 ? x : alt);
        return sum;
      },
      { minBatch: 5_000, maxBatch: 500_000 },
    );
    setResult({ value, ...stats });
  }, [n]);

  return (
    <div>
      <p className="text-sm text-muted-foreground">{t.demo.tabs.fib.desc}</p>
      <div className="mt-4 grid gap-2">
        <Label nativeID="demo-fib-n-label">{t.demo.tabs.fib.n}</Label>
        <Input
          nativeID="demo-fib-n"
          accessibilityLabelledBy="demo-fib-n-label"
          value={n}
          onChangeText={setN}
          inputMode="numeric"
          className="max-w-40 font-mono"
        />
      </div>
      <RunButton onRun={run} />
      {result ? <ResultView result={result} /> : null}
    </div>
  );
}
