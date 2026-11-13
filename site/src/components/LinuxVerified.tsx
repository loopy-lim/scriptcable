import { useI18n } from '../i18n';
import { Section } from './Section';

/** Today's on-machine verification evidence: command → actual output. */
export function LinuxVerified() {
  const { t } = useI18n();

  return (
    <Section eyebrow={t.linux.eyebrow} title={t.linux.title} sub={t.linux.sub}>
      <div className="overflow-hidden rounded-xl border border-border bg-muted/30">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="font-mono text-xs text-foreground">{t.linux.headerMeta}</span>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">2026-11-13</span>
        </div>
        {t.linux.rows.map((row, i) => (
          <div
            key={row.cmd}
            className={
              i > 0
                ? 'grid gap-1.5 border-t border-border px-4 py-3 md:grid-cols-[minmax(250px,0.9fr)_1.3fr] md:items-baseline md:gap-6'
                : 'grid gap-1.5 px-4 py-3 md:grid-cols-[minmax(250px,0.9fr)_1.3fr] md:items-baseline md:gap-6'
            }
          >
            <p className="min-w-0 break-words font-mono text-[13px] text-foreground">
              <span className="mr-2 select-none text-muted-foreground">$</span>
              {row.cmd}
            </p>
            <p className="min-w-0 break-words pl-5 font-mono text-[13px] text-muted-foreground md:pl-0">
              {row.out}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}
