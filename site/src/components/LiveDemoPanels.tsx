import { useCallback, useState } from 'react';
import { Play } from 'lucide-react';

import { Button, Input, Label, Tabs, TabsContent, TabsList, TabsTrigger } from '@unikit-bridge/ui';

// Drop-in: this import keeps pointing at the TypeScript core — the vite
// plugin (@unikit-bridge/scriptca/vite) swaps the module behind it for
// the compiled WASM client at build/dev time. These calls are native-speed
// WebAssembly in your browser, with zero call-site ceremony.
// This module is loaded via React.lazy so the WASM top-level-await lives in
// its own chunk: the page renders first, and a failed init is isolated by
// the error boundary in LiveDemo.tsx instead of blanking the site.
import { add, fib, repeat, sumBytes } from '../core';

import { useI18n } from '../i18n';

type DemoTabKey = 'add' | 'fib' | 'repeat' | 'bytes';

const SAMPLE_ROUNDS = 5;
const TARGET_SAMPLE_MS = 14;

// Module-level sink prevents JIT compilers from eliminating pure loops whose
// return value appears unused.
let benchSink = 0;

function calibrateBatch(
  runBatch: (count: number) => number,
  minBatch: number,
  maxBatch: number,
): number {
  // Initial JIT warmup before calibration
  benchSink += runBatch(Math.min(minBatch, 256));
  let count = minBatch;
  while (count < maxBatch) {
    const start = performance.now();
    benchSink += runBatch(count);
    const elapsed = performance.now() - start;
    if (elapsed >= TARGET_SAMPLE_MS) break;
    const scale = elapsed > 0.4 ? Math.ceil(TARGET_SAMPLE_MS / elapsed) : 4;
    count = Math.min(maxBatch, count * Math.min(8, Math.max(2, scale)));
  }
  return count;
}

function trimmedMean(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = sorted.length >= 3 ? sorted.slice(1, -1) : sorted;
  return middle.reduce((sum, v) => sum + v, 0) / middle.length;
}

function measurePair(
  wasmBatch: (count: number) => number,
  jsBatch: (count: number) => number,
  bounds: { minBatch: number; maxBatch: number },
): { wasm: number; js: number; wasmCalls: number; jsCalls: number; rounds: number } {
  const wasmCount = calibrateBatch(wasmBatch, bounds.minBatch, bounds.maxBatch);
  const jsCount = calibrateBatch(jsBatch, bounds.minBatch, bounds.maxBatch);

  const wasmSamples: number[] = [];
  const jsSamples: number[] = [];

  // Interleave execution order (AB / BA) across rounds to cancel GC or thermal bias.
  for (let r = 0; r < SAMPLE_ROUNDS; r++) {
    if (r % 2 === 0) {
      const t0 = performance.now();
      benchSink += wasmBatch(wasmCount);
      const t1 = performance.now();
      benchSink += jsBatch(jsCount);
      const t2 = performance.now();
      wasmSamples.push(((t1 - t0) * 1000) / wasmCount);
      jsSamples.push(((t2 - t1) * 1000) / jsCount);
    } else {
      const t0 = performance.now();
      benchSink += jsBatch(jsCount);
      const t1 = performance.now();
      benchSink += wasmBatch(wasmCount);
      const t2 = performance.now();
      jsSamples.push(((t1 - t0) * 1000) / jsCount);
      wasmSamples.push(((t2 - t1) * 1000) / wasmCount);
    }
  }

  return {
    wasm: trimmedMean(wasmSamples),
    js: trimmedMean(jsSamples),
    wasmCalls: wasmCount * SAMPLE_ROUNDS,
    jsCalls: jsCount * SAMPLE_ROUNDS,
    rounds: SAMPLE_ROUNDS,
  };
}

function formatDuration(micros: number): string {
  if (micros < 0.001) return '< 1 ns';
  if (micros < 1) {
    const ns = micros * 1000;
    return `${ns < 10 ? ns.toFixed(1) : Math.round(ns)} ns`;
  }
  if (micros >= 1000) return `${(micros / 1000).toFixed(2)} ms`;
  return `${micros.toFixed(2)} µs`;
}

// Plain-JS twins of the core exports — the baseline next to WASM.
const jsAdd = (a: number, b: number): number => a + b;
const jsFib = (n: number): number => {
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return a;
};
const jsRepeat = (text: string, times: number): string => {
  const parts: string[] = [];
  for (let i = 0; i < times; i++) parts.push(text);
  return parts.join(' / ');
};
const jsSumBytes = (data: Uint8Array): number => {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return sum;
};

function randomBytes(size: number): Uint8Array {
  const data = new Uint8Array(size);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(data);
  } else {
    for (let i = 0; i < size; i++) data[i] = Math.floor(Math.random() * 256);
  }
  return data;
}

type Result = {
  value: string;
  wasm: number;
  js: number;
  wasmCalls: number;
  jsCalls: number;
  rounds: number;
};

function ResultView({ result }: { result: Result }) {
  const { t } = useI18n();
  const maxTime = Math.max(result.wasm, result.js, 0.001);
  const wasmPct = Math.max(4, Math.min(100, Math.round((result.wasm / maxTime) * 100)));
  const jsPct = Math.max(4, Math.min(100, Math.round((result.js / maxTime) * 100)));

  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-border bg-muted/40 p-4 sm:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-xs text-muted-foreground">{t.demo.result}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {result.rounds} {t.demo.avgOf}
          </p>
        </div>
        <p className="mt-1.5 truncate font-mono text-xl font-semibold" title={result.value}>
          → {result.value}
        </p>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs text-muted-foreground">{t.demo.wasmTime}</p>
          <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {result.wasmCalls.toLocaleString()} {t.demo.callsUnit}
          </p>
        </div>
        <p className="mt-1 font-mono text-lg font-medium tabular-nums">
          {formatDuration(result.wasm)}
        </p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-foreground" style={{ width: `${wasmPct}%` }} />
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs text-muted-foreground">{t.demo.jsTime}</p>
          <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {result.jsCalls.toLocaleString()} {t.demo.callsUnit}
          </p>
        </div>
        <p className="mt-1 font-mono text-lg font-medium tabular-nums">
          {formatDuration(result.js)}
        </p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-muted-foreground/50"
            style={{ width: `${jsPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// UniKit's Button wraps children in a single Text span, so an icon next to a
// label needs its own inline-flex row to sit side by side.
function RunButton({ onRun }: { onRun: () => void }) {
  const { t } = useI18n();
  return (
    <Button onPress={onRun} className="mt-4">
      <span className="inline-flex flex-row items-center gap-1.5">
        <Play className="size-3.5" />
        {t.demo.run}
      </span>
    </Button>
  );
}

function AddPanel() {
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

function FibPanel() {
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

function RepeatPanel() {
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

function BytesPanel() {
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

/** The tabbed demo panels — imports the compiled core; lazy-loaded. */
export default function DemoPanels() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<DemoTabKey>('add');
  const activeMeta = t.demo.tabs[activeTab];

  return (
    <div className="grid gap-8 lg:grid-cols-12 lg:items-start">
      <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-muted/30 lg:col-span-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-3.5 py-2">
          <span className="font-mono text-xs text-foreground">{activeMeta.label}()</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {t.demo.abiLabel}: {activeMeta.abi}
          </span>
        </div>
        <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground">
          <code>{activeMeta.code}</code>
        </pre>
        <div className="border-t border-border px-3.5 py-2.5">
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            {t.demo.importNote}
          </p>
        </div>
      </div>

      <div className="min-w-0 lg:col-span-7">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as DemoTabKey)}>
          <TabsList>
            <TabsTrigger value="add">{t.demo.tabs.add.label}</TabsTrigger>
            <TabsTrigger value="fib">{t.demo.tabs.fib.label}</TabsTrigger>
            <TabsTrigger value="repeat">{t.demo.tabs.repeat.label}</TabsTrigger>
            <TabsTrigger value="bytes">{t.demo.tabs.bytes.label}</TabsTrigger>
          </TabsList>
          <TabsContent value="add" className="mt-5">
            <AddPanel />
          </TabsContent>
          <TabsContent value="fib" className="mt-5">
            <FibPanel />
          </TabsContent>
          <TabsContent value="repeat" className="mt-5">
            <RepeatPanel />
          </TabsContent>
          <TabsContent value="bytes" className="mt-5">
            <BytesPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
