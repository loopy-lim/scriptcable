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
      <div className="grid gap-4 lg:grid-cols-2">
        <CodeBlock
          title={t.beforeAfter.beforeCodeTitle}
          code={t.beforeAfter.beforeCode}
          className="min-w-0 opacity-85"
        />
        <CodeBlock
          title={t.beforeAfter.codeTitle}
          code={t.beforeAfter.code}
          className="min-w-0"
        />
      </div>

      <div className="mt-6 web:overflow-x-auto rounded-xl border border-border">
        <Table className="w-full min-w-[720px] text-sm">
          <TableHeader>
            <TableRow className="border-border bg-muted/50 web:hover:bg-muted/50">
              <TableHead className="h-10 flex-none w-[184px] px-4 font-medium">
                {t.beforeAfter.columns.what}
              </TableHead>
              <TableHead className="h-10 flex-1 min-w-0 px-4 font-medium">
                {t.beforeAfter.columns.before}
              </TableHead>
              <TableHead className="h-10 flex-1 min-w-0 px-4 font-medium">
                {t.beforeAfter.columns.now}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.beforeAfter.rows.map((row) => (
              <TableRow key={row.what} className="border-border">
                <TableCell className="flex-none w-[184px] px-4 py-3 font-medium">
                  {row.what}
                </TableCell>
                <TableCell className="flex-1 min-w-0 px-4 py-3 text-muted-foreground line-through decoration-muted-foreground/40 [&_span]:whitespace-normal">
                  {row.before}
                </TableCell>
                <TableCell className="flex-1 min-w-0 px-4 py-3 [&_span]:whitespace-normal">
                  {row.now}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}
