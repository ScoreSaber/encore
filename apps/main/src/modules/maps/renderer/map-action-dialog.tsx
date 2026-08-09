import { useTranslations } from 'use-intl';

import { ActionScopeRows, ContentActionDialog } from '@/components/content/content-action-dialog';

import type { TargetMapCollectionRequest } from '@/modules/maps/api';
import type { MapActionIssue } from '@/modules/maps/contract';
import type { MapActions } from '@/modules/maps/renderer/use-map-actions';
import { PreviewList } from '@/modules/operations/renderer/operation-progress';
import { useFormatters } from '@/renderer/i18n/formatters';
import type { MessageKey } from '@/renderer/i18n/keys';

const issueKeys: Record<MapActionIssue, MessageKey<'maps.issues'>> = {
   'already-installed': 'alreadyInstalled',
   'install-not-found': 'installNotFound',
   'inspect-failed': 'inspectFailed',
   'maps-missing': 'mapsMissing',
   'no-selection': 'noSelection',
   'no-source': 'noSource',
   'not-found': 'notFound',
   'source-unavailable': 'sourceUnavailable',
   'unsupported-target': 'unsupportedTarget'
};

export function MapActionDialog({ request, actions }: { request: TargetMapCollectionRequest; actions: MapActions }) {
   const t = useTranslations('maps.actions');
   const issues = useTranslations('maps.issues');
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
         description={kind === 'import' ? null : t(`${kind}.description`)}
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
                  <ActionScopeRows request={request} showPath={false} compact />
                  <PreviewList
                     items={preview.names.map((name, index) => ({
                        id: `${index}:${name}`,
                        label: name
                     }))}
                  />
                  <p className="text-muted-foreground text-xs">
                     {t('delete.sizeValue', {
                        size: format.bytes(preview.sizeBytes),
                        count: preview.fileCount
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
