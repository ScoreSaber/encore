import { useEffect, useState } from 'react';

import { Result } from 'better-result';
import { useTranslations } from 'use-intl';

import { cn } from '@/components/utils';

export function CopyableText({ text, className }: { text: string; className?: string }) {
   const t = useTranslations('common');
   const [copied, setCopied] = useState<{ text: string; count: number } | null>(null);
   const active = copied !== null && copied.text === text;

   useEffect(() => {
      if (!active) return;

      const timer = setTimeout(() => setCopied(null), 2000);
      return () => clearTimeout(timer);
   }, [active, copied?.count]);

   return (
      <button
         type="button"
         title={t('clickToCopy')}
         className={cn(
            'inline-grid min-w-0 cursor-pointer border-b border-dashed border-current/40 text-left transition-colors hover:border-current',
            className
         )}
         onClick={async () => {
            const wrote = await Result.tryPromise(() => window.encore.app.copyText({ text }));
            if (Result.isOk(wrote)) setCopied((current) => ({ text, count: (current?.count ?? 0) + 1 }));
         }}
      >
         <span className={cn('col-start-1 row-start-1 truncate transition-opacity duration-200', active && 'opacity-0')}>{text}</span>
         <span
            aria-hidden={!active}
            className={cn(
               'col-start-1 row-start-1 text-center font-sans tracking-normal opacity-0 transition-all duration-200',
               active ? 'translate-y-0 opacity-100' : 'translate-y-1'
            )}
         >
            {t('copied')}
         </span>
      </button>
   );
}
