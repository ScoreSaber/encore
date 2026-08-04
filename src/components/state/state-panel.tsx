import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { RefreshButton } from '@/components/refresh-button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/components/utils';

export function EmptyPanel({
   title,
   description,
   className,
   children
}: {
   title?: string;
   description: string;
   className?: string;
   children?: React.ReactNode;
}) {
   return (
      <div className={cn('text-muted-foreground rounded-md border border-dashed px-4 py-6 text-sm', className)}>
         {title ? <div className="text-foreground font-medium">{title}</div> : null}
         <p className={title ? 'mt-1' : undefined}>{description}</p>
         {children ? <div className="mt-3 flex flex-col items-start gap-3">{children}</div> : null}
      </div>
   );
}

export function ErrorPanel({
   message,
   detail,
   onRetry,
   className,
   children
}: {
   message: string;
   detail?: string;
   onRetry?: () => void;
   className?: string;
   children?: React.ReactNode;
}) {
   const common = useTranslations('common');

   return (
      <div className={cn('flex flex-col items-start gap-3 rounded-md border px-4 py-3 text-sm', className)}>
         <div className="flex min-w-0 gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
               <p className="break-words">{message}</p>
               {detail ? <p className="text-muted-foreground mt-1 text-xs break-all">{detail}</p> : null}
            </div>
         </div>

         {onRetry || children ? (
            <div className="flex flex-wrap items-center gap-2">
               {children}
               {onRetry ? <RefreshButton label={common('retry')} onClick={onRetry} /> : null}
            </div>
         ) : null}
      </div>
   );
}

export function WarningLine({ className, children }: { className?: string; children: React.ReactNode }) {
   return (
      <p className={cn('text-muted-foreground flex gap-2 text-xs', className)}>
         <AlertTriangle className="size-4 shrink-0" />
         <span className="min-w-0 break-words">{children}</span>
      </p>
   );
}

export function LoadingPanel({ rows = 3, className }: { rows?: number; className?: string }) {
   return (
      <div className={cn('animate-in fade-in-0 fill-mode-backwards flex flex-col gap-2 delay-150 duration-150', className)}>
         {Array.from({ length: rows }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-md" />
         ))}
      </div>
   );
}
