import { useTranslations } from 'use-intl';

import type { BSManagerCleanup } from '@/modules/bsmanager/renderer/use-bsmanager-cleanup';
import { OperationFlowDialog } from '@/modules/operations/renderer/operation-flow-dialog';

export function BSManagerCleanupDialog({ cleanup }: { cleanup: BSManagerCleanup }) {
   const t = useTranslations('bsmanager.cleanup');
   const { state } = cleanup.flow;
   const sharedContentPath = 'sharedContentPath' in state ? state.sharedContentPath : (cleanup.plan?.sharedContentPath ?? null);

   return (
      <OperationFlowDialog
         flow={cleanup.flow}
         title={t('title')}
         description={sharedContentPath ? t('description', { path: sharedContentPath }) : t('failed')}
         issue={() => t('failed')}
         preview={(ready, editable) =>
            editable ? (
               <ul className="divide-border rounded-md border">
                  {ready.affectedVersions.map((version) => (
                     <li key={version.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span>{version.name ?? version.version}</span>
                        <span className="text-muted-foreground text-xs">
                           {t('links', { count: version.folders.filter((folder) => folder.state === 'foreign').length })}
                        </span>
                     </li>
                  ))}
               </ul>
            ) : null
         }
         labels={{ failed: t('failed'), completed: t('completed'), cancelled: t('cancelled'), progress: (values) => t('progress', values) }}
         confirm={{ label: t('confirm'), run: cleanup.confirm }}
      />
   );
}
