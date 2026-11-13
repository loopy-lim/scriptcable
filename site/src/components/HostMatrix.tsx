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

export function HostMatrix() {
  const { t } = useI18n();

  return (
    <Section eyebrow={t.hosts.eyebrow} title={t.hosts.title} sub={t.hosts.sub}>
      <div className="web:overflow-x-auto rounded-lg border border-border">
        <Table className="w-full min-w-[720px] text-sm">
          <TableHeader>
            <TableRow className="border-border bg-muted/50 web:hover:bg-muted/50">
              <TableHead className="h-10 px-4 font-medium">{t.hosts.columns.host}</TableHead>
              <TableHead className="h-10 px-4 font-medium">{t.hosts.columns.how}</TableHead>
              <TableHead className="h-10 px-4 font-medium">{t.hosts.columns.verified}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.hosts.rows.map((row) => (
              <TableRow key={row.host} className="border-border">
                <TableCell className="px-4 py-3 font-medium">{row.host}</TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">{row.how}</TableCell>
                <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">
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
