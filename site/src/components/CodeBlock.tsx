import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { Button, cn } from '@unikit-bridge/ui';

import { useI18n } from '../i18n';

type CodeBlockProps = {
  code: string;
  title?: string;
  className?: string;
};

/** Terminal-style code panel with a working copy button (clipboard + fallback). */
export function CodeBlock({ code, title, className }: CodeBlockProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard API denied (e.g. non-secure context) — selection fallback.
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-muted/40', className)}>
      <div className="flex h-9 items-center justify-between border-b border-border px-3">
        <span className="font-mono text-xs text-muted-foreground">{title ?? 'sh'}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onPress={copy}
          aria-label={copied ? t.common.copied : t.common.copy}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
      <div className="relative">
        <pre className="web:overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-foreground">
          <code>{code}</code>
        </pre>
        {/* Touch scrollbars are invisible until dragged — hint that long
            lines continue on narrow screens (hidden where lines fit). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-r from-transparent to-muted/60 sm:hidden"
        />
      </div>
    </div>
  );
}
