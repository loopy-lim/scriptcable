import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import { Button, Input, Label } from '@unikit-bridge/ui';

// Drop-in: this import keeps pointing at the TypeScript core — the vite
// plugin swaps the module behind it for the compiled WASM client.
import { mandelbrotRgba } from '../../core';
import { useI18n } from '../../i18n';
import { benchSink, measurePair } from '../bench';
import { paintRgba, snapSize } from '../canvas';
import { jsMandelbrotRgba } from '../jsTwins';
import { ResultView, RunButton, type Result } from '../ResultViews';
import type { MandelbrotPresetKey } from '../types';

type View = { cx: number; cy: number; span: number };

/** Classic locations; `span` is the complex-plane width the frame covers. */
const PRESETS: Record<MandelbrotPresetKey, View & { iter: number }> = {
  home: { cx: -0.75, cy: 0, span: 3.2, iter: 160 },
  seahorse: { cx: -0.743643887037151, cy: 0.13182590420533, span: 0.005, iter: 640 },
  elephant: { cx: 0.2755, cy: 0.0053, span: 0.03, iter: 480 },
  spiral: { cx: -0.088, cy: 0.654, span: 0.02, iter: 640 },
};

const PRESET_ORDER: MandelbrotPresetKey[] = ['home', 'seahorse', 'elephant', 'spiral'];
const HOME = PRESETS.home;

/**
 * The flagship compute demo: per-pixel escape-time iteration over a whole
 * frame. Deep zooms make single frames slow, so measurement runs fewer
 * rounds and the button shows a busy state while the main thread works.
 */
export function MandelbrotPanel() {
  const { t } = useI18n();
  const [size, setSize] = useState('256');
  const [iter, setIter] = useState('256');
  const [view, setView] = useState<View>({ cx: HOME.cx, cy: HOME.cy, span: HOME.span });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Paint the home view once on mount — the flagship tab must never greet a
  // visitor with a blank canvas. Interactions repaint explicitly afterwards.
  useEffect(() => {
    const w = snapSize(Number(size) || 256);
    const iters = Math.min(1024, Math.max(32, Number(iter) || 256));
    paintRgba(canvasRef.current, renderWasm(w, iters, view), w, w);
    // Mount-only: state below is the deterministic initial state by design.
  }, []);

  const renderWasm = useCallback(
    (w: number, iters: number, v: View): Uint8Array =>
      mandelbrotRgba(w, w, v.cx, v.cy, v.span / w, iters),
    [],
  );

  /** Zoom 2× into a buffer-pixel point — preview-render only (no measurement). */
  const zoomTo = useCallback(
    (px: number, py: number) => {
      if (busy) return;
      const w = snapSize(Number(size) || 256);
      const scale = view.span / w;
      const next: View = {
        cx: view.cx + (px - w / 2) * scale,
        cy: view.cy + (py - w / 2) * scale,
        span: view.span / 2,
      };
      setView(next);
      paintRgba(
        canvasRef.current,
        renderWasm(w, Math.min(1024, Math.max(32, Number(iter) || 256)), next),
        w,
        w,
      );
      setResult(null); // timings belonged to the previous frame
    },
    [busy, iter, renderWasm, size, view],
  );

  const zoomAt = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = snapSize(Number(size) || 256);
      const rect = canvas.getBoundingClientRect();
      zoomTo(
        ((e.clientX - rect.left) / rect.width) * w,
        ((e.clientY - rect.top) / rect.height) * w,
      );
    },
    [size, zoomTo],
  );

  /** Enter/Space zooms the frame center — keyboard users get the same gesture. */
  const zoomOnKey = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const w = snapSize(Number(size) || 256);
      zoomTo(w / 2, w / 2);
    },
    [size, zoomTo],
  );

  const applyPreset = useCallback(
    (key: MandelbrotPresetKey) => {
      if (busy) return;
      const preset = PRESETS[key];
      const w = snapSize(Number(size) || 256);
      const iters = Math.min(1024, Math.max(32, preset.iter));
      setSize(String(w));
      setIter(String(iters));
      setView({ cx: preset.cx, cy: preset.cy, span: preset.span });
      paintRgba(canvasRef.current, renderWasm(w, iters, preset), w, w);
      setResult(null);
    },
    [busy, renderWasm, size],
  );

  const run = useCallback(() => {
    if (busy) return;
    const w = snapSize(Number(size) || 256);
    const iters = Math.min(1024, Math.max(32, Math.floor(Number(iter) || 256)));
    setSize(String(w));
    setIter(String(iters));
    setBusy(true);
    // Let the busy state paint before the synchronous measurement locks the
    // main thread (double rAF = one rendered frame).
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const preview = renderWasm(w, iters, view);
        paintRgba(canvasRef.current, preview, w, w);

        const stats = measurePair(
          (count) => {
            let sink = 0;
            for (let i = 0; i < count; i++) {
              const out = renderWasm(w, iters, view);
              sink += out[0] + out[out.length >> 1] + out[out.length - 1];
            }
            benchSink.value += sink;
            return sink;
          },
          (count) => {
            let sink = 0;
            for (let i = 0; i < count; i++) {
              const out = jsMandelbrotRgba(w, w, view.cx, view.cy, view.span / w, iters);
              sink += out[0] + out[out.length >> 1] + out[out.length - 1];
            }
            benchSink.value += sink;
            return sink;
          },
          { minBatch: 1, maxBatch: 8 },
        );

        setResult({
          value: `${w}×${w} · ${iters} iter · span ${view.span.toExponential(2)}`,
          ...stats,
        });
        setBusy(false);
      }),
    );
  }, [busy, iter, renderWasm, size, view]);

  return (
    <div>
      <p className="text-sm text-muted-foreground">{t.demo.tabs.mandelbrot.desc}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label nativeID="demo-mandelbrot-size-label">{t.demo.tabs.mandelbrot.size}</Label>
          <Input
            nativeID="demo-mandelbrot-size"
            accessibilityLabelledBy="demo-mandelbrot-size-label"
            value={size}
            onChangeText={setSize}
            inputMode="numeric"
            disabled={busy}
            className="max-w-40 font-mono"
          />
        </div>
        <div className="grid gap-2">
          <Label nativeID="demo-mandelbrot-iter-label">{t.demo.tabs.mandelbrot.iter}</Label>
          <Input
            nativeID="demo-mandelbrot-iter"
            accessibilityLabelledBy="demo-mandelbrot-iter-label"
            value={iter}
            onChangeText={setIter}
            inputMode="numeric"
            disabled={busy}
            className="max-w-40 font-mono"
          />
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        <p className="text-sm font-medium leading-none">{t.demo.tabs.mandelbrot.presets}</p>
        <div className="flex flex-wrap gap-2">
          {PRESET_ORDER.map((key) => (
            <Button
              key={key}
              variant="outline"
              size="sm"
              onPress={() => applyPreset(key)}
              disabled={busy}
            >
              {t.demo.tabs.mandelbrot.presetLabels[key]}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onPress={() => applyPreset('home')} disabled={busy}>
            <span className="inline-flex flex-row items-center gap-1.5">
              <RotateCcw className="size-3.5" />
              {t.demo.tabs.mandelbrot.reset}
            </span>
          </Button>
        </div>
      </div>

      <RunButton onRun={run} busy={busy} />

      <div className="mt-6">
        <canvas
          ref={canvasRef}
          onClick={zoomAt}
          onKeyDown={zoomOnKey}
          tabIndex={0}
          className="mx-auto block max-h-72 w-auto max-w-full cursor-zoom-in rounded-md border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={t.demo.tabs.mandelbrot.label}
        />
        <p className="mt-2 text-center font-mono text-[11px] text-muted-foreground">
          {t.demo.tabs.mandelbrot.zoomHint}
        </p>
      </div>

      {result ? <ResultView result={result} /> : null}
    </div>
  );
}
