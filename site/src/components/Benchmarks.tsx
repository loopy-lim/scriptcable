import {
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
    <Section eyebrow={t.bench.eyebrow} title={t.bench.title} sub={t.bench.sub}>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {t.bench.tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-border p-4">
            <dt className="text-xs text-muted-foreground">{tile.label}</dt>
            <dd className="mt-2 font-mono text-xl font-semibold tracking-tight whitespace-nowrap md:text-2xl">
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-14 text-lg font-semibold tracking-tight">{t.bench.boundaryTitle}</h3>
      <div className="mt-4 web:overflow-x-auto rounded-lg border border-border">
        <Table className="w-full min-w-[760px] text-sm">
          <TableHeader>
            <TableRow className="border-border bg-muted/50 web:hover:bg-muted/50">
              <TableHead className="h-10 flex-none w-[176px] px-4 font-medium">
                {t.bench.boundaryColumns.op}
              </TableHead>
              <TableHead className="h-10 flex-none w-[156px] px-4 font-medium">
                {t.bench.boundaryColumns.cost}
              </TableHead>
              <TableHead className="h-10 flex-1 min-w-[428px] px-4 font-medium">
                {t.bench.boundaryColumns.note}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.bench.boundaryRows.map((row) => (
              <TableRow key={row.op} className="border-border">
                <TableCell className="flex-none w-[176px] px-4 py-3 font-medium">
                  {row.op}
                </TableCell>
                <TableCell className="flex-none w-[156px] px-4 py-3 font-mono text-xs">
                  {row.cost}
                </TableCell>
                <TableCell className="flex-1 min-w-[428px] px-4 py-3 text-muted-foreground">
                  {row.note}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{t.bench.boundaryNote}</p>
    </Section>
  );
}
