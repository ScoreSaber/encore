import { Download, Merge, Music, Save, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { createProblem } from '@/lib/errors';
import { OperationFlowDialog } from '@/modules/operations/renderer/operation-flow-dialog';
import type { OperationFlow } from '@/modules/operations/renderer/use-operation-flow';
import type { TargetId } from '@/modules/targets/contract';

const notes: { key: 'description' | 'songs' | 'reinstall' | 'merge'; Icon: LucideIcon }[] = [
   { key: 'description', Icon: Save },
   { key: 'songs', Icon: Music },
   { key: 'reinstall', Icon: Download },
   { key: 'merge', Icon: Merge }
];

type QuestUnmodFlow = OperationFlow<{ kind: 'unmod' }>;

export function QuestUnmodDialog({ flow, targetId }: { flow: QuestUnmodFlow; targetId: TargetId }) {
   const t = useTranslations('quest.unmod');

   return (
      <OperationFlowDialog
         flow={flow}
         title={t('title')}
         description={t('description')}
         issue={() => t('result.failed')}
         preview={() => (
            <ul className="flex flex-col gap-2.5">
               {notes.map(({ key, Icon }) => (
                  <li key={key} className="flex gap-3">
                     <span className="bg-muted text-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
                        <Icon className="size-3.5" />
                     </span>
                     <span className="text-muted-foreground min-w-0 pt-1">{t(key)}</span>
                  </li>
               ))}
            </ul>
         )}
         labels={{
            failed: t('result.failed'),
            completed: t('result.completed'),
            cancelled: t('result.cancelled'),
            preparing: t('preparing')
         }}
         confirm={{
            label: t('confirm'),
            variant: 'destructive',
            run: (ready) => void flow.start(ready, () => window.encore.quest.unmod({ targetId }), createProblem('quest.unmod.start-failed'))
         }}
      />
   );
}
