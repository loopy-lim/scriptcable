import { useCallback, useState } from 'react';

import { Input, Label } from '@unikit-bridge/ui';

// Drop-in: this import keeps pointing at the TypeScript core — the vite
// plugin swaps the module behind it for the compiled WASM client.
import { add, sumRange } from '../../core';
import { useI18n } from '../../i18n';
import { benchSink, SAMPLE_ROUNDS, trimmedMean } from '../bench';
import { jsSumRange } from '../jsTwins';
import { BoundaryResultView, RunButton, type BoundaryResult } from '../ResultViews';

/** N×add vs 1×sumRange vs JS — the batching (coarse boundary) lesson. */
export function CoarsePanel() {
  const { t } = useI18n();
  const [n, setN] = useState('50000');
  const [result, setResult] = useState<BoundaryResult | null>(null);

  const run = useCallback(() => {
    const count = Math.min(500_000, Math.max(1_000, Math.floor(Number(n) || 50_000)));
    setN(String(count));

    // Warm both paths so the first timed sample is not a cold JIT hit.
    benchSink.value += add(1, 1);
    benchSink.value += sumRange(256);
    benchSink.value += jsSumRange(256);

    const chattySamples: number[] = [];
    const coarseSamples: number[] = [];
    const jsSamples: number[] = [];

    for (let r = 0; r < SAMPLE_ROUNDS; r++) {
      const order = r % 3;
      const measureChatty = () => {
        const t0 = performance.now();
        let sum = 0;
        for (let i = 0; i < count; i++) sum = add(sum, i);
        const t1 = performance.now();
        benchSink.value += sum;
        chattySamples.push(((t1 - t0) * 1000) / count);
      };
      const measureCoarse = () => {
        const t0 = performance.now();
        const sum = sumRange(count);
        const t1 = performance.now();
        benchSink.value += sum;
        coarseSamples.push(((t1 - t0) * 1000) / count);
      };
      const measureJs = () => {
        const t0 = performance.now();
        const sum = jsSumRange(count);
        const t1 = performance.now();
        benchSink.value += sum;
        jsSamples.push(((t1 - t0) * 1000) / count);
      };

      if (order === 0) {
        measureChatty();
        measureCoarse();
        measureJs();
      } else if (order === 1) {
        measureCoarse();
        measureJs();
        measureChatty();
      } else {
        measureJs();
        measureChatty();
        measureCoarse();
      }
    }

    setResult({
      value: sumRange(count).toLocaleString(),
      n: count,
      chatty: trimmedMean(chattySamples),
      coarse: trimmedMean(coarseSamples),
      js: trimmedMean(jsSamples),
    });
  }, [n]);

  return (
    <div>
      <p className="text-sm text-muted-foreground">{t.demo.tabs.coarse.desc}</p>
      <div className="mt-4 grid gap-2">
        <Label nativeID="demo-coarse-n-label">{t.demo.tabs.coarse.n}</Label>
        <Input
          nativeID="demo-coarse-n"
          accessibilityLabelledBy="demo-coarse-n-label"
          value={n}
          onChangeText={setN}
          inputMode="numeric"
          className="max-w-40 font-mono"
        />
      </div>
      <RunButton onRun={run} />
      {result ? <BoundaryResultView result={result} /> : null}
    </div>
  );
}
