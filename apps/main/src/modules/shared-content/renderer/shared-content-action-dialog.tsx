import { useState } from 'react';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { InstallScopeRows } from '@/modules/installs/renderer/install-scope-rows';
import { OperationFlowDialog } from '@/modules/operations/renderer/operation-flow-dialog';
import type { TargetSharedContentRequest } from '@/modules/shared-content/api';
import {
   isContentsModeAllowed,
   sharedContentsModeSchema,
   type ReadySharedContentPreview,
   type SharedContentAction,
   type SharedContentsMode
} from '@/modules/shared-content/contract';
import { useSharedFolderLabel } from '@/modules/shared-content/renderer/shared-folder-label';
import type { SharedContentActions } from '@/modules/shared-content/renderer/use-shared-content-actions';
import { useFormatters } from '@/renderer/i18n/formatters';

export function SharedContentActionDialog({ request, actions }: { request: TargetSharedContentRequest; actions: SharedContentActions }) {
   const t = useTranslations('sharedContent.actions');
   const issues = useTranslations('problems.shared-content');
   const { state } = actions.flow;
   const [lastAction, setLastAction] = useState<SharedContentAction>('link');

   if (state.status !== 'idle' && state.kind !== lastAction) setLastAction(state.kind);
   const action = state.status === 'idle' ? lastAction : state.kind;

   return (
      <OperationFlowDialog
         flow={actions.flow}
         className="sm:max-w-xl"
         title={t(`${action}.title`)}
         description={t(`${action}.description`)}
         issue={(problem) => issues(problem.issue)}
         preview={(ready, editable) => (
            <>
               <InstallScopeRows request={request} compact />
               <ActionPreview preview={ready.preview} />
               {editable ? <ContentsChoice preview={ready.preview} onChange={actions.setContents} /> : null}
            </>
         )}
         labels={{ failed: t('result.failed'), completed: t('result.completed'), cancelled: t('result.cancelled') }}
         confirm={{ label: t(`${action}.confirm`), run: actions.confirm }}
      />
   );
}

function ActionPreview({ preview }: { preview: ReadySharedContentPreview }) {
   const t = useTranslations('sharedContent.actions');
   const warnings = useTranslations('sharedContent.warnings');
   const folderLabel = useSharedFolderLabel();
   const format = useFormatters();

   const notices = [
      preview.conflictCount > 0 ? t('conflictsValue', { count: preview.conflictCount }) : null,
      preview.warnings.includes('move-blocked') ? warnings('move-blocked') : null,
      preview.warnings.includes('risky-folder') ? warnings('risky-folder') : null
   ].filter((notice): notice is string => notice !== null);

   return (
      <div className="flex flex-col gap-3">
         <div className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="font-medium">{folderLabel(preview.folderId, preview.relativePath)}</div>
            <dl className="grid grid-cols-2 gap-3">
               <div>
                  <dt className="text-muted-foreground text-xs">{t('installContents')}</dt>
                  <dd>{t('contentsValue', { size: format.bytes(preview.installBytes), files: preview.installFiles })}</dd>
               </div>
               <div>
                  <dt className="text-muted-foreground text-xs">{t('sharedContents')}</dt>
                  <dd>{t('contentsValue', { size: format.bytes(preview.sharedBytes), files: preview.sharedFiles })}</dd>
               </div>
               {preview.linkedInstalls.length > 0 ? (
                  <div className="col-span-2">
                     <dt className="text-muted-foreground text-xs">{t('linkedInstalls')}</dt>
                     <dd>{preview.linkedInstalls.join(', ')}</dd>
                  </div>
               ) : null}
            </dl>
         </div>

         {notices.length > 0 ? (
            <Alert variant="warning">
               <TriangleAlert />
               <AlertTitle>{t('review')}</AlertTitle>
               <AlertDescription>
                  {notices.map((notice) => (
                     <p key={notice}>{notice}</p>
                  ))}
               </AlertDescription>
            </Alert>
         ) : null}
      </div>
   );
}

function ContentsChoice({ preview, onChange }: { preview: ReadySharedContentPreview; onChange: (contents: SharedContentsMode) => void }) {
   const t = useTranslations('sharedContent.actions');
   const modes = sharedContentsModeSchema.options.filter((mode) => isContentsModeAllowed(preview.action, mode));

   if (modes.length < 2) return null;

   return (
      <div className="flex flex-col gap-3 rounded-lg border p-4">
         <div className="font-medium">{t(`contentsChoice.${preview.action === 'unlink' ? 'unlink' : 'link'}`)}</div>
         <ToggleGroup
            className="w-full"
            type="single"
            variant="outline"
            value={preview.contents}
            onValueChange={(next) => {
               if (next) onChange(sharedContentsModeSchema.parse(next));
            }}
         >
            {modes.map((mode) => (
               <ToggleGroupItem key={mode} className="flex-1" value={mode}>
                  {t(`contents.${mode}`)}
               </ToggleGroupItem>
            ))}
         </ToggleGroup>
         <p className="text-muted-foreground text-xs">
            {preview.contents === 'move'
               ? t(`contentsHint.move.${preview.action === 'unlink' ? 'unlink' : 'link'}`)
               : t(`contentsHint.${preview.contents}`)}
         </p>
      </div>
   );
}
