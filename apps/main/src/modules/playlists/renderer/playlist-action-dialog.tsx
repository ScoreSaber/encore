import { useTranslations } from 'use-intl';

import { Checkbox } from '@/components/ui/checkbox';

import { InstallScopeRows } from '@/modules/installs/renderer/install-scope-rows';
import { OperationFlowDialog } from '@/modules/operations/renderer/operation-flow-dialog';
import { PreviewList } from '@/modules/operations/renderer/operation-progress';
import type { TargetPlaylistCollectionRequest } from '@/modules/playlists/api';
import type { PlaylistActions } from '@/modules/playlists/renderer/use-playlist-actions';
import { useFormatters } from '@/renderer/i18n/formatters';

export function PlaylistActionDialog({ request, actions }: { request: TargetPlaylistCollectionRequest; actions: PlaylistActions }) {
   const t = useTranslations('playlists.actions');
   const issues = useTranslations('problems.playlists');
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
         preview={(ready, editable) =>
            ready.preview ? (
               <>
                  <InstallScopeRows request={request} compact />
                  <PreviewList items={ready.preview.names.map((name, index) => ({ id: `${index}:${name}`, label: name }))} />
                  <p className="text-muted-foreground text-xs">{t('delete.sizeValue', { size: format.bytes(ready.preview.sizeBytes) })}</p>
                  {ready.preview.deleteMaps ? (
                     <p className="text-muted-foreground text-xs">
                        {t('delete.mapsValue', { count: ready.preview.mapCount, size: format.bytes(ready.preview.mapSizeBytes) })}
                     </p>
                  ) : null}
                  {editable ? (
                     <label className="flex items-start gap-2">
                        <Checkbox checked={ready.preview.deleteMaps} onCheckedChange={(next) => actions.setDeleteMaps(next === true)} />
                        <span>
                           {t('delete.alsoMaps')}
                           <span className="text-muted-foreground block text-xs">{t('delete.alsoMapsHint')}</span>
                        </span>
                     </label>
                  ) : null}
               </>
            ) : null
         }
         labels={{ failed: t('result.failed'), completed: t('result.completed'), cancelled: t('result.cancelled') }}
         confirm={{ label: t('delete.confirm'), variant: 'destructive', run: actions.confirm }}
      />
   );
}
