import { useI18n } from '../i18n';
import { DOCS_URL, GITHUB_URL, NPM_PACKAGE, SITE_URL } from '../site';

export function Footer() {
  const { t } = useI18n();
  const npmUrl = `https://www.npmjs.com/package/${NPM_PACKAGE}`;

  return (
    <footer className="border-t border-border">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <span className="flex size-6 items-center justify-center rounded-md bg-foreground font-mono text-xs font-semibold text-background">
                sc
              </span>
              <span className="font-semibold tracking-tight">scriptca</span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{t.footer.tagline}</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground web:transition-colors web:hover:text-foreground"
            >
              {t.footer.links.github}
            </a>
            <a
              href={npmUrl}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground web:transition-colors web:hover:text-foreground"
            >
              {t.footer.links.npm}
            </a>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground web:transition-colors web:hover:text-foreground"
            >
              {t.footer.links.docs}
            </a>
            <a
              href={`${GITHUB_URL}/blob/main/BENCHMARK.md`}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground web:transition-colors web:hover:text-foreground"
            >
              {t.footer.links.benchmarks}
            </a>
          </nav>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>{t.footer.license}</p>
          <p className="font-mono">{SITE_URL.replace('https://', '')}</p>
        </div>
      </div>
    </footer>
  );
}
