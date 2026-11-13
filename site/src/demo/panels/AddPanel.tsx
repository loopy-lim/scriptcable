import { useCallback, useState } from 'react';

import { Input, Label } from '@unikit-bridge/ui';

// Drop-in: this import keeps pointing at the TypeScript core — the vite
// plugin swaps the module behind it for the compiled WASM client.
import { add } from '../../core';
import { useI18n } from '../../i18n';
import { measurePair } from '../bench';
import { jsAdd } from '../jsTwins';
import { ResultView, RunButton, type Result } from '../ResultViews';

/** Honest baseline: call overhead dominates, WASM loses on tiny calls. */
export function AddPanel() {
  const { t } = useI18n();
  const [a, setA] = useState('20');
  const [b, setB] = useState('22');
  const [result, setResult] = useState<Result | null>(null);

  const run = useCallback(() => {
    const x = Number(a);
    const y = Number(b);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const value = String(add(x, y));
    const stats = measurePair(
      (count) => {
        let sum = 0;
        for (let i = 0; i < count; i++) sum += add(x + (i & 1), y);
        return sum;
      },
      (count) => {
        let sum = 0;
        for (let i = 0; i < count; i++) sum += jsAdd(x + (i & 1), y);
        return sum;
      },
      { minBatch: 10_000, maxBatch: 1_000_000 },
    );
    setResult({ value, ...stats });
  }, [a, b]);

  return (
    <div>
      <p className="text-sm text-muted-foreground">{t.demo.tabs.add.desc}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label nativeID="demo-add-a-label">{t.demo.tabs.add.a}</Label>
          <Input
            nativeID="demo-add-a"
            accessibilityLabelledBy="demo-add-a-label"
            value={a}
            onChangeText={setA}
            inputMode="decimal"
            className="max-w-40 font-mono"
          />
        </div>
        <div className="grid gap-2">
          <Label nativeID="demo-add-b-label">{t.demo.tabs.add.b}</Label>
          <Input
            nativeID="demo-add-b"
            accessibilityLabelledBy="demo-add-b-label"
            value={b}
            onChangeText={setB}
            inputMode="decimal"
            className="max-w-40 font-mono"
          />
        </div>
      </div>
      <RunButton onRun={run} />
      {result ? <ResultView result={result} /> : null}
    </div>
  );
}
