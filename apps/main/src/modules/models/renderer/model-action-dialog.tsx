import { useTranslations } from 'use-intl';

import { ActionScopeRows, ContentActionDialog } from '@/components/content/content-action-dialog';

import type { TargetModelCollectionRequest } from '@/modules/models/api';
import type { ModelActionIssue } from '@/modules/models/contract';
import type { ModelActions } from '@/modules/models/renderer/use-model-actions';
import { PreviewList } from '@/modules/operations/renderer/operation-progress';
import { useFormatters } from '@/renderer/i18n/formatters';
import type { MessageKeyMap } from '@/renderer/i18n/keys';

const issueKeys: MessageKeyMap<ModelActionIssue, 'models.issues'> = {
   'already-installed': 'alreadyInstalled',
   'inspect-failed': 'inspectFailed',
   'install-not-found': 'installNotFound',
   'models-missing': 'modelsMissing',
   'no-selection': 'noSelection',
   'no-source': 'noSource',
   'not-found': 'notFound',
   'source-unavailable': 'sourceUnavailable',
   'unsupported-target': 'unsupportedTarget',
   'unsupported-type': 'unsupportedType'
};

export function ModelActionDialog({ request, actions }: { request: TargetModelCollectionRequest; actions: ModelActions }) {
   const t = useTranslations('models.actions');
   const issues = useTranslations('models.issues');
   const common = useTranslations('common');
   const format = useFormatters();
   const { state } = actions;
   const kind = state.status === 'idle' ? 'delete' : state.kind;
   const preview = state.status === 'ready' || state.status === 'starting' || state.status === 'running' ? state.preview : null;

   return (
      <ContentActionDialog
         state={state}
         operation={actions.operation}
         title={kind === 'delete' && preview ? t('delete.action', { count: preview.names.length }) : t(`${kind}.title`)}
         description={t(`${kind}.description`)}
         issue={
            state.status === 'invalid' ? (
               <>
                  <p>{issues(issueKeys[state.problem.issue])}</p>
                  {state.problem.detail ? <p className="text-muted-foreground text-xs break-all">{state.problem.detail}</p> : null}
               </>
            ) : null
         }
         preview={
            preview ? (
               <>
                  <ActionScopeRows request={request} compact />
                  <PreviewList
                     items={preview.names.map((name, index) => ({
                        id: `${index}:${name}`,
                        label: name
                     }))}
                  />
                  <p className="text-muted-foreground text-xs">
                     {t('delete.sizeValue', {
                        size: format.bytes(preview.sizeBytes),
                        count: preview.modelCount
                     })}
                  </p>
               </>
            ) : null
         }
         confirm={actions.confirm}
         cancel={actions.cancel}
         dismiss={actions.dismiss}
         labels={{
            loading: common('loading'),
            failed: t('result.failed'),
            preparing: common('operation.preparing'),
            progress: (values) => common('operation.progress', values),
            completed: t('result.completed'),
            cancelled: t('result.cancelled'),
            confirm: t('delete.confirm')
         }}
      />
   );
}
