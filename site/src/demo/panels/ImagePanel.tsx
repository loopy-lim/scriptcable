import { useCallback, useRef, useState } from 'react';

import { Button, Input, Label } from '@unikit-bridge/ui';

// Drop-in: this import keeps pointing at the TypeScript core — the vite
// plugin swaps the module behind it for the compiled WASM client.
import {
  boxBlurRgba,
  grayscaleRgba,
  resizeNearestRgba,
  sobelRgba,
} from '../../core';
import { useI18n } from '../../i18n';
import { benchSink, measurePair } from '../bench';
import { paintRgba, snapSize, synthRgba } from '../canvas';
import {
  jsBoxBlurRgba,
  jsGrayscaleRgba,
  jsResizeNearestRgba,
  jsSobelRgba,
} from '../jsTwins';
import { ResultView, RunButton, type Result } from '../ResultViews';
import type { ImageFilter } from '../types';

const FILTERS: ImageFilter[] = ['grayscale', 'blur', 'resize', 'sobel'];

export function ImagePanel() {
  const { t } = useI18n();
  const [size, setSize] = useState('256');
  const [filter, setFilter] = useState<ImageFilter>('blur');
  const [result, setResult] = useState<Result | null>(null);
  const [meta, setMeta] = useState<string>('');
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const afterRef = useRef<HTMLCanvasElement>(null);

  const run = useCallback(() => {
    // Snap to common demo sizes so pixel counts stay predictable.
    const w = snapSize(Number(size) || 256);
    setSize(String(w));
    const h = w;
    const dstW = filter === 'resize' ? w >> 1 : w;
    const dstH = filter === 'resize' ? h >> 1 : h;

    const srcA = synthRgba(w, h, 11);
    const srcB = synthRgba(w, h, 29);
    paintRgba(beforeRef.current, srcA, w, h);

    const runWasm = (pixels: Uint8Array): Uint8Array => {
      const copy = pixels.slice();
      if (filter === 'grayscale') return grayscaleRgba(copy);
      if (filter === 'blur') return boxBlurRgba(copy, w, h);
      if (filter === 'resize') return resizeNearestRgba(copy, w, h, dstW, dstH);
      return sobelRgba(copy, w, h);
    };
    const runJs = (pixels: Uint8Array): Uint8Array => {
      const copy = pixels.slice();
      if (filter === 'grayscale') return jsGrayscaleRgba(copy);
      if (filter === 'blur') return jsBoxBlurRgba(copy, w, h);
      if (filter === 'resize') return jsResizeNearestRgba(copy, w, h, dstW, dstH);
      return jsSobelRgba(copy, w, h);
    };

    const preview = runWasm(srcA);
    paintRgba(afterRef.current, preview, dstW, dstH);

    const stats = measurePair(
      (count) => {
        let sink = 0;
        for (let i = 0; i < count; i++) {
          const out = runWasm((i & 1) === 0 ? srcA : srcB);
          sink += out[0] + out[out.length >> 1] + out[out.length - 1];
        }
        benchSink.value += sink;
        return sink;
      },
      (count) => {
        let sink = 0;
        for (let i = 0; i < count; i++) {
          const out = runJs((i & 1) === 0 ? srcA : srcB);
          sink += out[0] + out[out.length >> 1] + out[out.length - 1];
        }
        benchSink.value += sink;
        return sink;
      },
      {
        minBatch: 1,
        maxBatch: filter === 'blur' ? 16 : 64,
      },
    );

    setMeta(
      filter === 'resize'
        ? `${w}×${h} → ${dstW}×${dstH}`
        : `${w}×${h} · ${(w * h).toLocaleString()} px`,
    );
    setResult({
      value: t.demo.tabs.image.filterLabels[filter],
      ...stats,
    });
  }, [filter, size, t.demo.tabs.image.filterLabels]);

  return (
    <div>
      <p className="text-sm text-muted-foreground">{t.demo.tabs.image.desc}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label nativeID="demo-image-size-label">{t.demo.tabs.image.size}</Label>
          <Input
            nativeID="demo-image-size"
            accessibilityLabelledBy="demo-image-size-label"
            value={size}
            onChangeText={setSize}
            inputMode="numeric"
            className="max-w-40 font-mono"
          />
        </div>
        <div className="grid gap-2">
          <p className="text-sm font-medium leading-none">{t.demo.tabs.image.filter}</p>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((key) => (
              <Button
                key={key}
                variant={filter === key ? 'default' : 'outline'}
                size="sm"
                onPress={() => setFilter(key)}
              >
                {t.demo.tabs.image.filterLabels[key]}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <RunButton onRun={run} />

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-2 font-mono text-[11px] text-muted-foreground">
            {t.demo.tabs.image.before}
          </p>
          <canvas
            ref={beforeRef}
            className="max-h-56 w-full rounded-md border border-border bg-muted object-contain"
            aria-label={t.demo.tabs.image.before}
          />
        </div>
        <div className="min-w-0">
          <p className="mb-2 font-mono text-[11px] text-muted-foreground">
            {t.demo.tabs.image.after}
            {meta ? ` · ${meta}` : ''}
          </p>
          <canvas
            ref={afterRef}
            className="max-h-56 w-full rounded-md border border-border bg-muted object-contain"
            aria-label={t.demo.tabs.image.after}
          />
        </div>
      </div>

      {result ? <ResultView result={result} /> : null}
    </div>
  );
}
