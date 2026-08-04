import { useCallback } from 'react';

import { useSettings } from '@/modules/settings/renderer/settings-provider';
import { localTargetId, type TargetId } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';

export function useSelectedTarget() {
   const targetList = useTargets();
   const { snapshot, updateApp } = useSettings();
   const stored = snapshot?.app.selection.targetId ?? localTargetId;
   const targetId = targetList.status === 'ready' && !targetList.targets.some((target) => target.id === stored) ? localTargetId : stored;

   const selectTarget = useCallback(
      (next: TargetId) => {
         void updateApp({ selection: { targetId: next } });
      },
      [updateApp]
   );

   return { ...targetList, targetId, selectTarget };
}
