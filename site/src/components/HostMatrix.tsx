import { useState } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@unikit-bridge/ui';

import { useI18n, type HostCategory } from '../i18n';
import { Section } from './Section';

export function HostMatrix() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<HostCategory>('all');

  const rows =
    filter === 'all' ? t.hosts.rows : t.hosts.rows.filter((row) => row.category === filter);

  const filterBar = (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.hosts.title}>
      {t.hosts.filters.map((item) => {
        const active = item.id === filter;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => setFilter(item.id)}
            className={cn(
              'rounded-md border px-3 py-1.5 font-mono text-xs web:transition-colors',
              active
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-background text-muted-foreground web:hover:bg-muted/60 web:hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <Section
      id="hosts"
      eyebrow={t.hosts.eyebrow}
      title={t.hosts.title}
      sub={t.hosts.sub}
      headerRight={filterBar}
    >
      <div className="web:overflow-x-auto rounded-xl border border-border">
        <Table className="w-full min-w-[936px] text-sm">
          <TableHeader>
            <TableRow className="border-border bg-muted/50 web:hover:bg-muted/50">
              <TableHead className="h-10 flex-none w-[280px] px-4 font-medium">
                {t.hosts.columns.host}
              </TableHead>
              <TableHead className="h-10 flex-1 min-w-[424px] px-4 font-medium">
                {t.hosts.columns.how}
              </TableHead>
              <TableHead className="h-10 flex-none w-[232px] px-4 font-medium">
                {t.hosts.columns.verified}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.host} className="border-border">
                <TableCell className="flex-none w-[280px] px-4 py-3 font-medium">
                  {row.host}
                </TableCell>
                <TableCell className="flex-1 min-w-[424px] px-4 py-3 text-muted-foreground">
                  {row.how}
                </TableCell>
                <TableCell className="flex-none w-[232px] px-4 py-3 font-mono text-xs text-muted-foreground">
                  {row.verified}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}
