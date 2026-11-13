import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@unikit-bridge/ui';

import { useI18n } from '../i18n';
import { Section } from './Section';

export function Benchmarks() {
  const { t } = useI18n();

  return (
    <Section id="benchmarks" eyebrow={t.bench.eyebrow} title={t.bench.title} sub={t.bench.sub}>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {t.bench.tiles.map((tile) => (
          <div
            key={tile.label}
            className="flex flex-col justify-between rounded-xl border border-border bg-card p-5"
          >
            <div className="flex items-start justify-between gap-2">
              <dt className="text-xs leading-relaxed text-muted-foreground">{tile.label}</dt>
              <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
                {tile.tag}
              </Badge>
            </div>
            <dd className="mt-3 font-mono text-xl font-semibold tracking-tight tabular-nums whitespace-nowrap md:text-2xl">
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-12 text-lg font-semibold tracking-tight">{t.bench.boundaryTitle}</h3>
      <div className="mt-4 grid gap-6 lg:grid-cols-12 lg:items-start">
        <div className="min-w-0 lg:col-span-8 web:overflow-x-auto rounded-xl border border-border">
          <Table className="w-full min-w-[680px] text-sm">
            <TableHeader>
              <TableRow className="border-border bg-muted/50 web:hover:bg-muted/50">
                <TableHead className="h-10 flex-none w-[164px] px-4 font-medium">
                  {t.bench.boundaryColumns.op}
                </TableHead>
                <TableHead className="h-10 flex-none w-[148px] px-4 font-medium">
                  {t.bench.boundaryColumns.cost}
                </TableHead>
                <TableHead className="h-10 flex-1 min-w-0 px-4 font-medium">
                  {t.bench.boundaryColumns.note}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.bench.boundaryRows.map((row) => (
                <TableRow key={row.op} className="border-border">
                  <TableCell className="flex-none w-[164px] px-4 py-3 font-medium">
                    {row.op}
                  </TableCell>
                  <TableCell className="flex-none w-[148px] px-4 py-3 font-mono text-xs tabular-nums">
                    {row.cost}
                  </TableCell>
                  <TableCell className="flex-1 min-w-0 px-4 py-3 text-muted-foreground [&_span]:whitespace-normal">
                    {row.note}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <aside className="min-w-0 lg:col-span-4 rounded-xl border border-border bg-muted/30 p-5">
          <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {t.bench.calloutTitle}
          </p>
          <p className="mt-2.5 text-sm font-medium leading-relaxed text-foreground">
            {t.bench.calloutBody}
          </p>
          <ul className="mt-3 grid gap-2 text-xs leading-relaxed text-muted-foreground">
            {t.bench.calloutPoints.map((pt) => (
              <li key={pt} className="flex items-start gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground/60" />
                <span>{pt}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </Section>
  );
}
