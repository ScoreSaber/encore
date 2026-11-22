import { useTranslations } from 'use-intl';

import { WarningLine } from '@/components/state/state-panel';

import type { InstallActionRequest } from '@/modules/installs/contract';
import { InstallScopeRows } from '@/modules/installs/renderer/install-scope-rows';
import type { ReadyModChangesPreview, ReadyModImportPreview, ReadyModInstallPreview, ReadyModUninstallPreview } from '@/modules/mods/contract';
import type { InstallMods } from '@/modules/mods/renderer/use-install-mods';
import { OperationFlowDialog } from '@/modules/operations/renderer/operation-flow-dialog';
import { PreviewList, PreviewRow } from '@/modules/operations/renderer/operation-progress';
import { useFormatters } from '@/renderer/i18n/formatters';

export function ModActionDialog({ request, mods }: { request: InstallActionRequest; mods: InstallMods }) {
   const t = useTranslations('mods');
   const { state } = mods.flow;
   const kind = state.status === 'idle' ? 'install' : state.kind;
   const counted =
      (state.status === 'ready' || state.status === 'starting' || state.status === 'running') &&
      (state.kind === 'install' || state.kind === 'uninstall')
         ? state
         : null;

   return (
      <OperationFlowDialog
         flow={mods.flow}
         title={counted ? t(`${counted.kind}.action`, { count: counted.preview.mods.length }) : t(`${kind}.title`)}
         description={t(`${kind}.description`, { platform: mods.platform })}
         issue={(problem) => t(`issues.${problem.issue}`, { platform: mods.platform })}
         preview={(ready) => (
            <>
               <InstallScopeRows
                  request={request}
                  showPath={ready.kind !== 'uninstall'}
                  compact={ready.kind === 'install' || ready.kind === 'uninstall' || ready.kind === 'changes'}
               />

               {ready.kind === 'install' ? <InstallPreview preview={ready.preview} /> : null}
               {ready.kind === 'uninstall' ? <UninstallPreview preview={ready.preview} /> : null}
               {ready.kind === 'changes' ? <ChangesPreview preview={ready.preview} /> : null}
               {ready.kind === 'import' ? <ImportPreview preview={ready.preview} /> : null}
               {ready.preview.warnings.map((warning) => (
                  <WarningLine key={warning}>{t(`warnings.${warning}`, { platform: mods.platform })}</WarningLine>
               ))}
            </>
         )}
         labels={{
            failed: t(`${kind}.result.failed`),
            completed: t(`${kind}.result.completed`),
            cancelled: t(`${kind}.result.cancelled`),
            preparing: t(`${kind}.preparing`),
            progress: (values) => t(`${kind}.progress`, values)
         }}
         confirm={{
            label: t(`${kind}.confirm`),
            variant: kind === 'uninstall' ? 'destructive' : 'default',
            run: mods.confirm
         }}
      />
   );
}

function ChangesPreview({ preview }: { preview: ReadyModChangesPreview }) {
   const t = useTranslations('mods');

   return (
      <>
         <p className="font-medium">{t('changes.install')}</p>
         <InstallPreview preview={preview.install} />
         <p className="font-medium">{t('changes.remove')}</p>
         <UninstallPreview preview={preview.uninstall} />
      </>
   );
}

function InstallPreview({ preview }: { preview: ReadyModInstallPreview }) {
   const t = useTranslations('mods');
   const format = useFormatters();

   return (
      <>
         <PreviewList
            items={preview.mods.map((mod) => ({
               id: mod.modId,
               label: `${mod.name}${mod.reason === 'dependency' ? ` ${t('install.dependency')}` : ''}`,
               detail: mod.version
            }))}
         />
         {preview.downloadBytes === null ? null : (
            <p className="text-muted-foreground text-xs">{t('install.downloadSize', { size: format.bytes(preview.downloadBytes) })}</p>
         )}
      </>
   );
}

function UninstallPreview({ preview }: { preview: ReadyModUninstallPreview }) {
   const t = useTranslations('mods');

   return (
      <>
         <PreviewList items={preview.mods.map((mod) => ({ id: mod.modId, label: mod.name, detail: mod.version }))} />
         <p className="text-muted-foreground text-xs">{t('uninstall.fileCount', { count: preview.fileCount })}</p>
         {preview.external.length > 0 ? (
            <p className="text-muted-foreground text-xs">{t('uninstall.externalCount', { count: preview.external.length })}</p>
         ) : null}
      </>
   );
}

function ImportPreview({ preview }: { preview: ReadyModImportPreview }) {
   const t = useTranslations('mods');
   const format = useFormatters();

   return (
      <>
         <PreviewRow label={t('import.source')} value={preview.sourcePath} />
         <PreviewRow label={t('import.destination')} value={preview.destinationPath} />
         <PreviewRow label={t('size')} value={format.bytes(preview.sizeBytes)} />
      </>
   );
}
