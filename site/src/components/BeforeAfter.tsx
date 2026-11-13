import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@unikit-bridge/ui';

import { useI18n } from '../i18n';
import { CodeBlock } from './CodeBlock';
import { Section } from './Section';

export function BeforeAfter() {
  const { t } = useI18n();

  return (
    <Section eyebrow={t.beforeAfter.eyebrow} title={t.beforeAfter.title} sub={t.beforeAfter.sub}>
      <div className="web:overflow-x-auto rounded-lg border border-border">
        <Table className="w-full min-w-[720px] text-sm">
          <TableHeader>
            <TableRow className="border-border bg-muted/50 web:hover:bg-muted/50">
              <TableHead className="h-10 px-4 font-medium">
                {t.beforeAfter.columns.what}
              </TableHead>
              <TableHead className="h-10 px-4 font-medium">
                {t.beforeAfter.columns.before}
              </TableHead>
              <TableHead className="h-10 px-4 font-medium">{t.beforeAfter.columns.now}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.beforeAfter.rows.map((row) => (
              <TableRow key={row.what} className="border-border">
                <TableCell className="px-4 py-3 font-medium">{row.what}</TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground line-through decoration-muted-foreground/40">
                  {row.before}
                </TableCell>
                <TableCell className="px-4 py-3">{row.now}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="mt-8 max-w-xl">
        <CodeBlock title={t.beforeAfter.codeTitle} code={t.beforeAfter.code} />
      </div>
    </Section>
  );
}
