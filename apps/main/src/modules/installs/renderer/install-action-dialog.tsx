import { useRef } from 'react';

import { useTranslations } from 'use-intl';

import type { InstallActionRequest } from '@/modules/installs/contract';
import { InstallScopeRows } from '@/modules/installs/renderer/install-scope-rows';
import type { InstallActions } from '@/modules/installs/renderer/use-install-actions';
import { OperationFlowDialog } from '@/modules/operations/renderer/operation-flow-dialog';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import { useFormatters } from '@/renderer/i18n/formatters';

export function InstallActionDialog({ request, actions }: { request: InstallActionRequest; actions: InstallActions }) {
   const t = useTranslations('installs.manage');
   const problems = useTranslations('problems.installs.manage');
   const format = useFormatters();
   const { state } = actions.flow;
   const lastKind = useRef<'delete' | 'forget'>('delete');
   if (state.status !== 'idle') lastKind.current = state.kind;
   const kind = state.status === 'idle' ? lastKind.current : state.kind;

   return (
      <OperationFlowDialog
         flow={actions.flow}
         title={t(`${kind}.title`)}
         description={t(`${kind}.description`)}
         issue={(problem) => problems(problem.issue)}
         preview={(ready) => (
            <>
               <InstallScopeRows request={request} showPath={false} />
               <PreviewRow label={t(`${ready.kind}.path`)} value={ready.preview.path} />
               {ready.kind === 'delete' ? (
                  <PreviewRow
                     label={t('size')}
                     value={t('sizeValue', { size: format.bytes(ready.preview.sizeBytes), count: ready.preview.fileCount })}
                  />
               ) : null}
            </>
         )}
         labels={{
            failed: t(`${kind}.result.failed`),
            completed: t('delete.result.completed'),
            cancelled: t('delete.result.cancelled'),
            preparing: t('delete.preparing'),
            progress: (values) => t('delete.progress', values)
         }}
         confirm={{
            label: t(`${kind}.confirm`),
            variant: kind === 'delete' ? 'destructive' : 'default',
            disabled: actions.forgetting,
            run: actions.confirm
         }}
      />
   );
}
