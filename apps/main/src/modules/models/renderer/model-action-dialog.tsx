import { useTranslations } from 'use-intl';

import { InstallScopeRows } from '@/modules/installs/renderer/install-scope-rows';
import type { TargetModelCollectionRequest } from '@/modules/models/api';
import type { ModelActions } from '@/modules/models/renderer/use-model-actions';
import { OperationFlowDialog } from '@/modules/operations/renderer/operation-flow-dialog';
import { PreviewList } from '@/modules/operations/renderer/operation-progress';
import { useFormatters } from '@/renderer/i18n/formatters';

export function ModelActionDialog({ request, actions }: { request: TargetModelCollectionRequest; actions: ModelActions }) {
   const t = useTranslations('models.actions');
   const issues = useTranslations('problems.models');
   const format = useFormatters();
   const { state } = actions.flow;
   const kind = state.status === 'idle' ? 'delete' : state.kind;
   const deleting = (state.status === 'ready' || state.status === 'starting' || state.status === 'running') && state.kind === 'delete' ? state : null;

   return (
      <OperationFlowDialog
         flow={actions.flow}
         title={deleting ? t('delete.action', { count: deleting.preview.names.length }) : t(`${kind}.title`)}
         description={t(`${kind}.description`)}
         issue={(problem) => issues(problem.issue)}
         preview={(ready) =>
            ready.preview ? (
               <>
                  <InstallScopeRows request={request} compact />
                  <PreviewList items={ready.preview.names.map((name, index) => ({ id: `${index}:${name}`, label: name }))} />
                  <p className="text-muted-foreground text-xs">
                     {t('delete.sizeValue', { size: format.bytes(ready.preview.sizeBytes), count: ready.preview.modelCount })}
                  </p>
               </>
            ) : null
         }
         labels={{ failed: t('result.failed'), completed: t('result.completed'), cancelled: t('result.cancelled') }}
         confirm={{ label: t('delete.confirm'), variant: 'destructive', run: actions.confirm }}
      />
   );
}
