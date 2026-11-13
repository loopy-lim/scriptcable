import type { ReactNode } from 'react';

import { cn } from '@unikit-bridge/ui';

type SectionProps = {
  id?: string;
  eyebrow: string;
  title: string;
  sub?: string;
  headerRight?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Shared page rhythm: hairline divider, eyebrow label, title, lede, content. */
export function Section({
  id,
  eyebrow,
  title,
  sub,
  headerRight,
  children,
  className,
}: SectionProps) {
  return (
    <section id={id} className={cn('border-t border-border py-16 md:py-24', className)}>
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              {eyebrow}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">{title}</h2>
            {sub ? <p className="mt-3 max-w-2xl text-muted-foreground">{sub}</p> : null}
          </div>
          {headerRight ? (
            <div className="shrink-0 self-start md:self-auto">{headerRight}</div>
          ) : null}
        </div>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}
