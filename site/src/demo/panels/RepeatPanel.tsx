import { useCallback, useState } from 'react';

import { Input, Label } from '@unikit-bridge/ui';

// Drop-in: this import keeps pointing at the TypeScript core — the vite
// plugin swaps the module behind it for the compiled WASM client.
import { repeat } from '../../core';
import { useI18n } from '../../i18n';
import { measurePair } from '../bench';
import { jsRepeat } from '../jsTwins';
import { ResultView, RunButton, type Result } from '../ResultViews';

/** Honest baseline: string round-trips pay copy + UTF-8 on every call. */
export function RepeatPanel() {
  const { t } = useI18n();
  const [text, setText] = useState('scriptca');
  const [times, setTimes] = useState('5');
  const [result, setResult] = useState<Result | null>(null);

  const run = useCallback(() => {
    const s = text.slice(0, 24) || 'scriptca';
    const sAlt = `${s.slice(0, -1)}${s.endsWith('0') ? '1' : '0'}`;
    const count = Math.min(12, Math.max(1, Math.floor(Number(times) || 1)));
    setText(s);
    setTimes(String(count));
    const value = repeat(s, count);
    const stats = measurePair(
      (iterations) => {
        let len = 0;
        for (let i = 0; i < iterations; i++) len += repeat((i & 1) === 0 ? s : sAlt, count).length;
        return len;
      },
      (iterations) => {
        let len = 0;
        for (let i = 0; i < iterations; i++)
          len += jsRepeat((i & 1) === 0 ? s : sAlt, count).length;
        return len;
      },
      { minBatch: 1_000, maxBatch: 50_000 },
    );
    setResult({ value, ...stats });
  }, [text, times]);

  return (
    <div>
      <p className="text-sm text-muted-foreground">{t.demo.tabs.repeat.desc}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label nativeID="demo-repeat-text-label">{t.demo.tabs.repeat.text}</Label>
          <Input
            nativeID="demo-repeat-text"
            accessibilityLabelledBy="demo-repeat-text-label"
            value={text}
            onChangeText={setText}
            maxLength={24}
            className="max-w-56"
          />
        </div>
        <div className="grid gap-2">
          <Label nativeID="demo-repeat-times-label">{t.demo.tabs.repeat.times}</Label>
          <Input
            nativeID="demo-repeat-times"
            accessibilityLabelledBy="demo-repeat-times-label"
            value={times}
            onChangeText={setTimes}
            inputMode="numeric"
            className="max-w-24 font-mono"
          />
        </div>
      </div>
      <RunButton onRun={run} />
      {result ? <ResultView result={result} /> : null}
    </div>
  );
}
