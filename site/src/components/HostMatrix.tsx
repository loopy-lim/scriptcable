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
        <Table className="w-full min-w-[936px] text-sm">
          <TableHeader>
            <TableRow className="border-border bg-muted/50 web:hover:bg-muted/50">
              <TableHead className="h-10 flex-none w-[268px] px-4 font-medium">
                {t.hosts.columns.host}
              </TableHead>
              <TableHead className="h-10 flex-1 min-w-[436px] px-4 font-medium">
                {t.hosts.columns.how}
              </TableHead>
              <TableHead className="h-10 flex-none w-[232px] px-4 font-medium">
                {t.hosts.columns.verified}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.hosts.rows.map((row) => (
              <TableRow key={row.host} className="border-border">
                <TableCell className="flex-none w-[268px] px-4 py-3 font-medium">
                  {row.host}
                </TableCell>
                <TableCell className="flex-1 min-w-[436px] px-4 py-3 text-muted-foreground">
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
