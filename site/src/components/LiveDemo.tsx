import { Component, lazy, Suspense, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@unikit-bridge/ui';

import { useI18n } from '../i18n';
import { Section } from './Section';

// The demo panels import the compiled core (WASM top-level await at module
// load). Loading them lazily splits that module graph into its own chunk:
// the page paints without it, a failed init (offline wasm, blocked fetch,
// magic-word mismatch) is caught by the boundary below — shown as an error
// card inside this shell instead of blanking the whole site.
const DemoPanels = lazy(() => import('./LiveDemoPanels'));

/**
 * Catches failures of the lazy chunk above — module init errors surface as
 * render-phase errors through React.lazy, so this boundary actually fires.
 */
class DemoErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[demo] core chunk failed to load:', error);
  }

  render() {
    return this.state.failed ? <DemoErrorCard /> : this.props.children;
  }
}

function DemoLoading() {
  const { t } = useI18n();
  return (
    <div className="grid gap-6 lg:grid-cols-12" aria-busy="true" aria-label={t.demo.loading}>
      <div className="h-52 animate-pulse rounded-lg bg-muted lg:col-span-5" />
      <div className="grid gap-4 lg:col-span-7">
        <div className="h-9 w-72 animate-pulse rounded-md bg-muted" />
        <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-10 w-1/2 animate-pulse rounded-md bg-muted" />
        <div className="mt-2 h-9 w-28 animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  );
}

function DemoErrorCard() {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-dashed border-border p-6">
      <p className="font-medium">{t.demo.errorTitle}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t.demo.errorBody}</p>
      {/* UniKit Button stacks children vertically — inline-flex row for icon+label */}
      <Button variant="outline" onPress={() => window.location.reload()} className="mt-4">
        <span className="inline-flex flex-row items-center gap-1.5">
          <RotateCcw className="size-3.5" />
          {t.demo.retry}
        </span>
      </Button>
    </div>
  );
}

export function LiveDemo() {
  const { t } = useI18n();

  return (
    <Section
      id="demo"
      eyebrow={t.demo.eyebrow}
      title={t.demo.title}
      sub={t.demo.sub}
      headerRight={
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 font-mono text-[11px] font-medium text-secondary-foreground">
          <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
          <span>{t.demo.badge}</span>
        </div>
      }
    >
      <Card>
        <CardHeader className="border-b border-border pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="font-mono text-base">{t.demo.sourceTitle}</CardTitle>
            <CardDescription className="font-mono text-xs">
              mandelbrot · image · sumRange · fib · sumBytes · add · repeat
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <DemoErrorBoundary>
            <Suspense fallback={<DemoLoading />}>
              <DemoPanels />
            </Suspense>
          </DemoErrorBoundary>
        </CardContent>
      </Card>
    </Section>
  );
}
