import { ChevronRight } from 'lucide-react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/components/utils';

export function SettingsSection({
   title,
   headerAction,
   children
}: {
   title?: React.ReactNode;
   headerAction?: React.ReactNode;
   children: React.ReactNode;
}) {
   return (
      <section className="flex min-w-0 flex-col gap-2.5">
         {title || headerAction ? (
            <div className="flex min-h-7 items-center justify-between gap-4">
               {title ? <h2 className="text-foreground/70 text-sm font-normal">{title}</h2> : null}
               {headerAction ? <div className="flex shrink-0 items-center gap-1.5">{headerAction}</div> : null}
            </div>
         ) : null}
         <SettingsGroup>{children}</SettingsGroup>
      </section>
   );
}

export function FoldedSettingsSection({
   title,
   summary,
   control,
   open,
   onOpenChange,
   children
}: {
   title: string;
   summary?: string;
   control?: React.ReactNode;
   open: boolean;
   onOpenChange: (open: boolean) => void;
   children: React.ReactNode;
}) {
   return (
      <Collapsible open={open} onOpenChange={onOpenChange} asChild>
         <section className="bg-card/40 border-border/60 min-w-0 rounded-xl border shadow-xs">
            <div className="flex items-center gap-4 px-3 sm:px-4">
               <CollapsibleTrigger className="focus-visible:ring-ring flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md py-2 text-left outline-none focus-visible:ring-2">
                  <ChevronRight
                     aria-hidden="true"
                     className={cn(
                        'text-muted-foreground size-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none',
                        open && 'rotate-90'
                     )}
                  />
                  <span className="shrink-0 text-sm font-medium">{title}</span>
                  {summary ? <span className="text-muted-foreground min-w-0 truncate text-xs">{summary}</span> : null}
               </CollapsibleTrigger>
               {control ? <div className="flex shrink-0 items-center gap-2">{control}</div> : null}
            </div>
            <CollapsibleContent className="border-border/50 [&>*+*]:border-border/50 border-t [&>*+*]:border-t">{children}</CollapsibleContent>
         </section>
      </Collapsible>
   );
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
   return (
      <div className="bg-card/40 border-border/60 [&>*+*]:border-border/50 relative min-w-0 rounded-xl border shadow-xs [&>*+*]:border-t">
         {children}
      </div>
   );
}

export function SettingsRow({
   title,
   description,
   status,
   control,
   htmlFor,
   className,
   children
}: {
   title: React.ReactNode;
   description?: React.ReactNode;
   status?: React.ReactNode;
   control?: React.ReactNode;
   htmlFor?: string;
   className?: string;
   children?: React.ReactNode;
}) {
   return (
      <div data-slot="settings-row" className={cn('@container/settings-row px-3 py-3 sm:px-4', className)}>
         <div className="flex flex-col gap-3 @lg/settings-row:grid @lg/settings-row:grid-cols-[minmax(0,1fr)_auto] @lg/settings-row:items-center @lg/settings-row:gap-8">
            <div className="min-w-0 space-y-1">
               {htmlFor ? (
                  <label htmlFor={htmlFor} className="flex min-h-5 items-center text-sm font-medium">
                     {title}
                  </label>
               ) : (
                  <h3 className="flex min-h-5 items-center gap-1.5 text-sm font-medium">{title}</h3>
               )}
               {description ? <div className="text-muted-foreground/80 max-w-xl text-xs leading-normal break-words">{description}</div> : null}
               {status ? <div className="text-muted-foreground pt-0.5 text-xs">{status}</div> : null}
            </div>
            {control ? (
               <div className="flex w-full min-w-0 shrink-0 items-center gap-2 @lg/settings-row:w-auto @lg/settings-row:justify-end">{control}</div>
            ) : null}
         </div>
         {children}
      </div>
   );
}

export function SettingsLoading() {
   return (
      <>
         <LoadingSection rows={3} />
         <LoadingSection rows={2} />
      </>
   );
}

function LoadingSection({ rows }: { rows: number }) {
   return (
      <section className="flex flex-col gap-2.5">
         <Skeleton className="h-4 w-24" />
         <SettingsGroup>
            {Array.from({ length: rows }).map((_, index) => (
               <div key={index} className="flex items-center justify-between gap-6 px-3 py-3 sm:px-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-8 w-36" />
               </div>
            ))}
         </SettingsGroup>
      </section>
   );
}
