import { useTranslations } from 'use-intl';

import { ActionScopeRows, ContentActionDialog } from '@/components/content/content-action-dialog';
import { Checkbox } from '@/components/ui/checkbox';

import { PreviewList } from '@/modules/operations/renderer/operation-progress';
import type { TargetPlaylistCollectionRequest } from '@/modules/playlists/api';
import type { PlaylistActionIssue } from '@/modules/playlists/contract';
import type { PlaylistActions } from '@/modules/playlists/renderer/use-playlist-actions';
import { useFormatters } from '@/renderer/i18n/formatters';
import type { MessageKey } from '@/renderer/i18n/keys';

const issueKeys: Record<PlaylistActionIssue, MessageKey<'playlists.issues'>> = {
   'install-not-found': 'installNotFound',
   'inspect-failed': 'inspectFailed',
   'invalid-source': 'invalidSource',
   'no-missing-maps': 'noMissingMaps',
   'no-selection': 'noSelection',
   'no-source': 'noSource',
   'not-found': 'notFound',
   'playlists-missing': 'playlistsMissing',
   'source-unavailable': 'sourceUnavailable',
   'unsupported-target': 'unsupportedTarget'
};

export function PlaylistActionDialog({ request, actions }: { request: TargetPlaylistCollectionRequest; actions: PlaylistActions }) {
   const t = useTranslations('playlists.actions');
   const issues = useTranslations('playlists.issues');
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
                  <ActionScopeRows request={request} showPath={false} compact />
                  <PreviewList items={preview.names.map((name, index) => ({ id: `${index}:${name}`, label: name }))} />
                  <p className="text-muted-foreground text-xs">{t('delete.sizeValue', { size: format.bytes(preview.sizeBytes) })}</p>
                  {preview.deleteMaps ? (
                     <p className="text-muted-foreground text-xs">
                        {t('delete.mapsValue', { count: preview.mapCount, size: format.bytes(preview.mapSizeBytes) })}
                     </p>
                  ) : null}
                  {state.status === 'ready' ? (
                     <label className="flex items-start gap-2">
                        <Checkbox
                           checked={state.preview.deleteMaps}
                           onCheckedChange={(next) => void actions.previewDelete(state.selection, next === true)}
                        />
                        <span>
                           {t('delete.alsoMaps')}
                           <span className="text-muted-foreground block text-xs">{t('delete.alsoMapsHint')}</span>
                        </span>
                     </label>
                  ) : null}
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
