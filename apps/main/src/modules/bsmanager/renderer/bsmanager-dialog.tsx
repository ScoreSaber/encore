import type { ColumnDef } from '@tanstack/react-table';
import { useTranslations } from 'use-intl';

import { RefreshButton } from '@/components/refresh-button';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import type { BSManagerIssue, BSManagerVersion, ReadyBSManagerPlan } from '@/modules/bsmanager/contract';
import type { BSManagerAdopter } from '@/modules/bsmanager/renderer/use-bsmanager-adoption';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import type { MessageKeyMap } from '@/renderer/i18n/keys';

const issueKeys: MessageKeyMap<BSManagerIssue, 'bsmanager.issues'> = {
   'inspect-failed': 'inspectFailed',
   'not-bsmanager': 'notBSManager',
   'not-found': 'notFound',
   'nothing-selected': 'nothingSelected',
   'nothing-to-clean': 'nothingToClean',
   'nothing-to-adopt': 'nothingToAdopt',
   'register-failed': 'registerFailed',
   'unsupported-target': 'unsupportedTarget'
};

export function BSManagerDialog({ adopter }: { adopter: BSManagerAdopter }) {
   const t = useTranslations('bsmanager');
   const common = useTranslations('common');
   const { state, selected } = adopter;
   const open = state.status !== 'idle';
   const busy = state.status === 'adopting';

   return (
      <Dialog
         open={open}
         onOpenChange={(nextOpen) => {
            if (nextOpen || busy) return;

            adopter.dismiss();
         }}
      >
         <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
               <DialogTitle>{t('title')}</DialogTitle>
               <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto text-sm">
               {state.status === 'loading' ? <p>{common('loading')}</p> : null}

               {state.status === 'invalid' ? (
                  <>
                     <p>{t(`issues.${issueKeys[state.plan.issue]}`)}</p>
                     {state.plan.detail ? <p className="text-muted-foreground text-xs break-all">{state.plan.detail}</p> : null}
                  </>
               ) : null}

               {state.status === 'failed' ? (
                  <>
                     <p>{t('result.failed')}</p>
                     <p className="text-muted-foreground text-xs break-all">{state.error.message}</p>
                  </>
               ) : null}

               {state.status === 'ready' || state.status === 'adopting' ? (
                  <BSManagerPlanBody
                     plan={state.plan}
                     selected={selected}
                     shareContent={adopter.shareContent}
                     editable={state.status === 'ready'}
                     onToggle={adopter.toggleVersion}
                     onShareContentChange={adopter.setShareContent}
                  />
               ) : null}

               {state.status === 'adopted' ? (
                  <>
                     <p>{t('result.adopted', { count: state.outcome.adopted })}</p>
                     <PreviewRow label={t('sharedRoot')} value={state.outcome.sharedRootPath} />
                  </>
               ) : null}
            </div>

            <DialogFooter>
               {state.status === 'ready' || state.status === 'adopting' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" disabled={busy} onClick={adopter.dismiss}>
                        {common('cancel')}
                     </Button>
                     <Button type="button" size="sm" disabled={busy || selected.length === 0} onClick={() => void adopter.confirm()}>
                        {t('confirm')}
                     </Button>
                  </>
               ) : null}

               {state.status === 'invalid' || state.status === 'adopted' ? (
                  <Button type="button" size="sm" onClick={adopter.dismiss}>
                     {common('close')}
                  </Button>
               ) : null}

               {state.status === 'failed' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={adopter.dismiss}>
                        {common('close')}
                     </Button>
                     <RefreshButton label={common('retry')} variant="default" onClick={() => void adopter.open()} />
                  </>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

function BSManagerPlanBody({
   plan,
   selected,
   shareContent,
   editable,
   onToggle,
   onShareContentChange
}: {
   plan: ReadyBSManagerPlan;
   selected: string[];
   shareContent: boolean;
   editable: boolean;
   onToggle: BSManagerAdopter['toggleVersion'];
   onShareContentChange: (next: boolean) => void;
}) {
   const t = useTranslations('bsmanager');

   const columns: ColumnDef<BSManagerVersion>[] = [
      {
         id: 'select',
         size: 40,
         enableResizing: false,
         meta: { control: true },
         cell: ({ row }) => (
            <Checkbox
               id={`bsmanager-version-${row.original.id}`}
               checked={selected.includes(row.original.id)}
               disabled={!editable || row.original.status !== 'ready'}
               onCheckedChange={(next) => onToggle(row.original.id, next === true)}
            />
         )
      },
      {
         id: 'version',
         header: t('table.version'),
         meta: { flex: true },
         cell: ({ row }) => (
            <label htmlFor={`bsmanager-version-${row.original.id}`} className="flex flex-col">
               <span className="truncate">{row.original.name ?? row.original.version}</span>
               {row.original.name ? <span className="text-muted-foreground truncate text-xs">{row.original.version}</span> : null}
            </label>
         )
      },
      {
         id: 'store',
         size: 100,
         header: t('table.store'),
         cell: ({ row }) => (row.original.store ? t(`store.${row.original.store}`) : t('store.unknown'))
      },
      {
         id: 'shared',
         size: 160,
         header: t('table.shared'),
         cell: ({ row }) => {
            const linked = row.original.folders.filter((folder) => folder.state === 'linked').length;
            const foreign = row.original.folders.filter((folder) => folder.state === 'foreign').length;

            if (foreign > 0) return t('shared.outside', { count: foreign });

            return linked === 0 ? t('shared.none') : t('shared.linked', { count: linked, total: row.original.folders.length });
         }
      },
      {
         id: 'status',
         size: 120,
         header: t('table.status'),
         meta: { cellClassName: 'text-muted-foreground' },
         cell: ({ row }) => t(`status.${row.original.status}`)
      }
   ];

   return (
      <>
         <PreviewRow label={t('source')} value={plan.versionsPath} />
         <PreviewRow label={t('sharedContent')} value={plan.sharedContentPath} />

         <DataTable
            columns={columns}
            data={plan.versions}
            getRowId={(version) => version.id}
            label={t('table.version')}
            virtual={false}
            className="max-h-72"
         />

         <div className="flex items-start gap-2">
            <Checkbox
               id="bsmanager-share-content"
               checked={shareContent}
               disabled={!editable}
               onCheckedChange={(next) => onShareContentChange(next === true)}
            />
            <label htmlFor="bsmanager-share-content" className="flex flex-col gap-0.5">
               <span>{t('shareContent')}</span>
               <span className="text-muted-foreground text-xs">{t('shareContentHint', { path: plan.sharedContentPath })}</span>
            </label>
         </div>
      </>
   );
}
