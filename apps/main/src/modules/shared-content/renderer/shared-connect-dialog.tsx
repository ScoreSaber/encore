import { useState } from 'react';

import { useTranslations } from 'use-intl';

import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { OperationFlowDialog } from '@/modules/operations/renderer/operation-flow-dialog';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import {
   isConnectContentsAllowed,
   sharedContentsModeSchema,
   type ReadySharedConnectPreview,
   type SharedConnectAction,
   type SharedContentsMode
} from '@/modules/shared-content/contract';
import { SharedFolderStateBadge } from '@/modules/shared-content/renderer/shared-folder-actions';
import { useSharedFolderLabel } from '@/modules/shared-content/renderer/shared-folder-label';
import type { SharedConnect } from '@/modules/shared-content/renderer/use-shared-connect';
import { useFormatters } from '@/renderer/i18n/formatters';

export function SharedConnectDialog({ connect }: { connect: SharedConnect }) {
   const t = useTranslations('sharedContent.connect');
   const actions = useTranslations('sharedContent.actions');
   const issues = useTranslations('problems.shared-content');
   const { state } = connect.flow;
   const [lastAction, setLastAction] = useState<SharedConnectAction>('connect');

   if (state.status !== 'idle' && state.kind !== lastAction) setLastAction(state.kind);
   const action = state.status === 'idle' ? lastAction : state.kind;

   return (
      <OperationFlowDialog
         flow={connect.flow}
         className="sm:max-w-2xl"
         title={t(`${action}.title`)}
         description={t(`${action}.description`)}
         issue={(problem) => issues(problem.issue)}
         preview={(ready, editable) => (
            <>
               <PreviewRow label={t('install')} value={ready.target.installName} />
               <ConnectPreview preview={ready.preview} />
               {editable ? (
                  <>
                     <ContentsChoice preview={ready.preview} onChange={connect.setContents} />
                     <RiskyChoice preview={ready.preview} onChange={connect.setIncludeRisky} />
                  </>
               ) : null}
            </>
         )}
         labels={{ failed: actions('result.failed'), completed: actions('result.completed'), cancelled: actions('result.cancelled') }}
         confirm={{
            label: t(`${action}.confirm`),
            disabled: state.status === 'ready' && state.preview.folders.every((folder) => folder.step === 'skip'),
            run: connect.confirm
         }}
      />
   );
}

function ConnectPreview({ preview }: { preview: ReadySharedConnectPreview }) {
   const t = useTranslations('sharedContent.connect');
   const shared = useTranslations('sharedContent');
   const actions = useTranslations('sharedContent.actions');
   const warnings = useTranslations('sharedContent.warnings');
   const format = useFormatters();
   const folderLabel = useSharedFolderLabel();
   const planned = preview.folders.filter((folder) => folder.step !== 'skip');

   return (
      <>
         <PreviewRow label={t('root')} value={preview.rootPath} />

         <div className="max-h-64 overflow-auto rounded-md border">
            <Table>
               <TableHeader>
                  <TableRow>
                     <TableHead>{shared('columns.folder')}</TableHead>
                     <TableHead>{shared('columns.state')}</TableHead>
                     <TableHead>{t('columns.plan')}</TableHead>
                     <TableHead className="text-right">{t('columns.contents')}</TableHead>
                  </TableRow>
               </TableHeader>
               <TableBody>
                  {preview.folders.map((folder) => (
                     <TableRow key={folder.id} className={folder.step === 'skip' ? 'opacity-60' : undefined}>
                        <TableCell className="min-w-0 whitespace-normal">
                           <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{folderLabel(folder.id, folder.relativePath)}</span>
                              {folder.risky ? <Badge variant="secondary">{shared('risky')}</Badge> : null}
                           </div>
                        </TableCell>
                        <TableCell>
                           <SharedFolderStateBadge state={folder.state} />
                        </TableCell>
                        <TableCell className="text-xs">{t(`steps.${folder.step}`)}</TableCell>
                        <TableCell className="text-muted-foreground text-right text-xs whitespace-nowrap">
                           {folder.step !== 'skip' && folder.files > 0
                              ? actions('contentsValue', { size: format.bytes(folder.bytes), files: folder.files })
                              : null}
                           {folder.conflictCount > 0 ? <div>{t('conflicts', { count: folder.conflictCount })}</div> : null}
                        </TableCell>
                     </TableRow>
                  ))}
               </TableBody>
            </Table>
         </div>

         {planned.length === 0 ? <p className="text-muted-foreground text-xs">{t('nothingPlanned')}</p> : null}

         {preview.warnings.map((warning) => (
            <p key={warning} className="text-muted-foreground text-xs">
               {warnings(warning)}
            </p>
         ))}
      </>
   );
}

function ContentsChoice({ preview, onChange }: { preview: ReadySharedConnectPreview; onChange: (contents: SharedContentsMode) => void }) {
   const t = useTranslations('sharedContent.actions');
   const connect = useTranslations('sharedContent.connect');
   const modes = sharedContentsModeSchema.options.filter((mode) => isConnectContentsAllowed(preview.action, mode));

   if (modes.length < 2) return null;

   return (
      <div className="flex flex-col gap-2">
         <div className="font-medium">{t(`contentsChoice.${preview.action === 'disconnect' ? 'unlink' : 'link'}`)}</div>
         <ToggleGroup
            className="flex-wrap justify-start"
            type="single"
            spacing={2}
            value={preview.contents}
            onValueChange={(next) => {
               if (next) onChange(sharedContentsModeSchema.parse(next));
            }}
         >
            {modes.map((mode) => (
               <ToggleGroupItem key={mode} value={mode}>
                  {t(`contents.${mode}`)}
               </ToggleGroupItem>
            ))}
         </ToggleGroup>
         <p className="text-muted-foreground text-xs">{connect(`contentsHint.${preview.contents}`)}</p>
      </div>
   );
}

function RiskyChoice({ preview, onChange }: { preview: ReadySharedConnectPreview; onChange: (includeRisky: boolean) => void }) {
   const t = useTranslations('sharedContent.connect');

   if (preview.action !== 'connect') return null;

   return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
         <div className="min-w-0">
            <Label htmlFor="shared-connect-risky">{t('includeRisky')}</Label>
            <p className="text-muted-foreground text-xs">{t('includeRiskyHint')}</p>
         </div>
         <Switch id="shared-connect-risky" checked={preview.includeRisky} onCheckedChange={onChange} />
      </div>
   );
}
