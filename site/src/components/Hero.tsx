import { useState } from 'react';
import { ArrowDown, ArrowRight } from 'lucide-react';

import { Badge, cn } from '@unikit-bridge/ui';

import { useI18n } from '../i18n';
import { GITHUB_URL } from '../site';
import { CodeBlock } from './CodeBlock';

function TargetRouter() {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState(t.hero.router.targets[0].id);
  const active =
    t.hero.router.targets.find((item) => item.id === selectedId) ?? t.hero.router.targets[0];

  return (
    <div className="rounded-xl border border-border bg-card shadow-xs">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="font-mono text-xs text-muted-foreground">{t.hero.router.header}</span>
        <Badge variant="secondary" className="font-mono text-[11px]">
          {t.hero.router.badge}
        </Badge>
      </div>

      <div className="grid gap-3 p-4">
        <div className="min-w-0 rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              {t.hero.router.sourceLabel}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {t.hero.router.sourceFile}
            </span>
          </div>
          <p className="mt-1.5 overflow-x-auto font-mono text-xs text-foreground whitespace-nowrap">
            {t.hero.router.sourceCode}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 font-mono text-[11px] text-muted-foreground">
          <ArrowDown className="size-3.5 shrink-0" />
          <span className="whitespace-nowrap font-medium text-foreground/85">
            {t.hero.router.compilerLabel}
          </span>
          <span className="hidden text-muted-foreground/75 sm:inline">
            · {t.hero.router.compilerDetail}
          </span>
        </div>

        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {t.hero.router.targetLabel}
          </p>
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={t.hero.router.targetLabel}>
            {t.hero.router.targets.map((target) => {
              const selected = target.id === active.id;
              return (
                <button
                  key={target.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedId(target.id)}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs font-medium web:transition-colors',
                    selected
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-background text-foreground web:hover:bg-muted/60',
                  )}
                >
                  <span className="truncate">{target.label}</span>
                  <span
                    className={cn(
                      'shrink-0 font-mono text-[10px]',
                      selected ? 'text-background/75' : 'text-muted-foreground',
                    )}
                  >
                    {target.kind}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-3.5">
          <div className="grid gap-2.5 text-xs">
            <div>
              <p className="font-mono text-[11px] text-muted-foreground">
                {t.hero.router.artifactLabel}
              </p>
              <p className="mt-0.5 font-mono font-medium text-foreground">{active.artifact}</p>
            </div>
            <div>
              <p className="font-mono text-[11px] text-muted-foreground">
                {t.hero.router.wiringLabel}
              </p>
              <p className="mt-0.5 text-foreground">{active.wiring}</p>
              <p className="mt-1 text-muted-foreground">{active.note}</p>
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-border bg-muted/40 p-3">
          <p className="font-mono text-[11px] text-muted-foreground">
            {t.hero.router.callSiteLabel}
          </p>
          <pre className="mt-1.5 overflow-x-auto font-mono text-xs leading-relaxed text-foreground">
            <code>{t.hero.router.callSiteCode}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  const { t } = useI18n();

  return (
    <section id="top" className="relative web:overflow-hidden">
      <div className="dot-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_60%_65%_at_22%_0%,black,transparent)]" />
      <div className="relative mx-auto w-full max-w-6xl px-6 pb-16 pt-14 md:pb-24 md:pt-20">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-start lg:gap-12">
          <div className="min-w-0 lg:col-span-7">
            <p className="font-mono text-xs text-muted-foreground md:text-sm">
              {/* nbsp before each `·` so wrapped lines never start with a
                  dangling separator */}
              {t.hero.eyebrow.split(' · ').join(' · ')}
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-5xl lg:text-[56px] lg:leading-[1.08]">
              {t.hero.title1}
              <br />
              {t.hero.title2}
            </h1>
            <p className="mt-5 max-w-2xl text-muted-foreground md:text-lg">{t.hero.sub}</p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground web:transition-opacity web:hover:opacity-90"
              >
                {t.hero.ctaPrimary}
                <ArrowRight className="size-4" />
              </a>
              <a
                href="#demo"
                className="inline-flex h-10 items-center rounded-md border border-border bg-background px-5 text-sm font-medium text-foreground web:transition-colors web:hover:bg-accent"
              >
                {t.hero.ctaSecondary}
              </a>
            </div>
            <div className="mt-10 max-w-xl">
              <CodeBlock title={t.hero.quickstartLabel} code={t.hero.quickstart} />
              <p className="mt-2.5 text-xs text-muted-foreground">{t.hero.quickstartNote}</p>
            </div>
          </div>

          <div className="min-w-0 lg:col-span-5 lg:pt-2">
            <TargetRouter />
          </div>
        </div>
      </div>
    </section>
  );
}
