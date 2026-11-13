import { useI18n } from '../i18n';
import { Section } from './Section';

/** Today's on-machine verification evidence: command → actual output. */
export function LinuxVerified() {
  const { t } = useI18n();

  return (
    <Section eyebrow={t.linux.eyebrow} title={t.linux.title} sub={t.linux.sub}>
      <div className="overflow-hidden rounded-lg border border-border bg-muted/40">
        {t.linux.rows.map((row, i) => (
          <div
            key={row.cmd}
            className={i > 0 ? 'border-t border-border px-4 py-3' : 'px-4 py-3'}
          >
            <p className="font-mono text-[13px]">
              <span className="mr-2 select-none text-muted-foreground">$</span>
              {row.cmd}
            </p>
            <p className="mt-1 pl-5 font-mono text-[13px] text-muted-foreground">{row.out}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
