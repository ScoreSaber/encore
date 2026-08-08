import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/components/utils';

import { PageBody } from '@/app/renderer/shell/page-body';

export function SettingsPageShell({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
   return (
      <PageBody className="@container/settings-page max-w-5xl gap-5">
         <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl font-semibold">{title}</h1>
            {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
         </div>
         {children}
      </PageBody>
   );
}

export function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
   return (
      <section className="grid min-w-0 grid-cols-1 gap-3 border-t py-5 first:border-t-0 first:pt-0 @lg/settings-page:grid-cols-[9rem_minmax(0,1fr)] @lg/settings-page:gap-8">
         <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
         <FieldGroup className="min-w-0 gap-0">{children}</FieldGroup>
      </section>
   );
}

export function SettingsRow({
   label,
   description,
   htmlFor,
   id,
   className,
   controlClassName = 'flex w-full min-w-0 justify-start @md/field-group:w-auto @md/field-group:min-w-56 @md/field-group:justify-end',
   children
}: {
   label: string;
   description?: string;
   htmlFor?: string;
   id?: string;
   className?: string;
   controlClassName?: string;
   children?: React.ReactNode;
}) {
   return (
      <Field orientation="responsive" className={cn('min-h-11 py-2.5 first:pt-0 last:pb-0', className)}>
         <FieldContent className="min-w-0 gap-0.5">
            {htmlFor ? <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel> : <FieldTitle id={id}>{label}</FieldTitle>}
            {description ? <FieldDescription className="text-xs break-words">{description}</FieldDescription> : null}
         </FieldContent>
         {children ? <div className={controlClassName}>{children}</div> : null}
      </Field>
   );
}

export function SettingsLoading() {
   return (
      <div className="flex flex-col">
         <LoadingSection rows={3} />
         <LoadingSection rows={1} />
         <LoadingSection rows={2} />
      </div>
   );
}

function LoadingSection({ rows }: { rows: number }) {
   return (
      <section className="grid grid-cols-1 gap-3 border-t py-5 first:border-t-0 first:pt-0 @lg/settings-page:grid-cols-[9rem_minmax(0,1fr)] @lg/settings-page:gap-8">
         <Skeleton className="h-4 w-24" />
         <div>
            {Array.from({ length: rows }).map((_, index) => (
               <div key={index} className="flex min-h-11 items-center justify-between gap-6 py-2.5 first:pt-0 last:pb-0">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-8 w-36" />
               </div>
            ))}
         </div>
      </section>
   );
}
