import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';

import { PageBody } from '@/app/renderer/shell/page-body';

export function SettingsPageShell({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
   return (
      <PageBody className="gap-6">
         <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl font-semibold">{title}</h1>
            {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
         </div>
         {children}
      </PageBody>
   );
}

export function SettingsSection({ title, children }: { title?: string; children: React.ReactNode }) {
   return (
      <section className="mt-6 flex min-w-0 flex-col gap-2 border-t pt-6 first:mt-0 first:border-t-0 first:pt-0">
         {title ? <h2 className="text-base font-semibold tracking-tight">{title}</h2> : null}
         <FieldGroup className="gap-0">{children}</FieldGroup>
      </section>
   );
}

export function SettingsRow({
   label,
   description,
   htmlFor,
   id,
   controlClassName = 'flex w-full min-w-0 justify-start @md/field-group:w-auto @md/field-group:min-w-56 @md/field-group:justify-end',
   children
}: {
   label: string;
   description?: string;
   htmlFor?: string;
   id?: string;
   controlClassName?: string;
   children?: React.ReactNode;
}) {
   return (
      <Field orientation="responsive" className="py-2">
         <FieldContent className="min-w-0 gap-0.5 @md/field-group:self-end">
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
         <LoadingSection rows={2} />
         <LoadingSection rows={2} />
         <LoadingSection rows={2} />
      </div>
   );
}

function LoadingSection({ rows }: { rows: number }) {
   return (
      <section className="mt-6 flex flex-col gap-2 border-t pt-6 first:mt-0 first:border-t-0 first:pt-0">
         <Skeleton className="h-5 w-40" />
         {Array.from({ length: rows }).map((_, index) => (
            <div key={index} className="flex items-center justify-between gap-6 py-2">
               <Skeleton className="h-4 w-32" />
               <Skeleton className="h-8 w-36" />
            </div>
         ))}
      </section>
   );
}
