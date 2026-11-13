import { buttonVariants, cn } from '@unikit-bridge/ui';

import { useI18n } from '../i18n';
import { GITHUB_URL } from '../site';
import { CodeBlock } from './CodeBlock';

/** Landing hero: tagline, primary actions, copyable quickstart over a dot grid. */
export function Hero() {
  const { t } = useI18n();

  return (
    <section id="top" className="relative web:overflow-hidden">
      <div className="dot-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_55%_60%_at_50%_0%,black,transparent)]" />
      <div className="relative mx-auto w-full max-w-5xl px-6 pb-16 pt-16 text-center md:pb-24 md:pt-28">
        <p className="font-mono text-xs text-muted-foreground md:text-sm">{t.hero.eyebrow}</p>
        <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight md:text-6xl">
          {t.hero.title1}
          <br />
          {t.hero.title2}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-muted-foreground md:text-lg">
          {t.hero.sub}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ size: 'lg' }), 'text-primary-foreground')}
          >
            {t.hero.ctaPrimary}
          </a>
          <a
            href="#demo"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'lg' }),
              'text-foreground',
            )}
          >
            {t.hero.ctaSecondary}
          </a>
        </div>
        <div className="mx-auto mt-14 max-w-xl text-left">
          <CodeBlock title={t.hero.quickstartLabel} code={t.hero.quickstart} />
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {t.hero.quickstartNote}
          </p>
        </div>
      </div>
    </section>
  );
}
