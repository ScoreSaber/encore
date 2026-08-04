import { useCallback } from 'react';

import type { InstallId } from '@/modules/installs/contract';
import { useInstalls } from '@/modules/installs/renderer/use-installs';
import { useSettings } from '@/modules/settings/renderer/settings-provider';
import type { TargetId } from '@/modules/targets/contract';

export function useSelectedInstall(targetId: TargetId) {
   const installs = useInstalls(targetId);
   const { snapshot, updateApp } = useSettings();
   const summaries = installs.snapshot?.installs ?? [];
   const selected = snapshot?.app.selection.installIds[targetId];
   const installId = (selected && summaries.some((install) => install.id === selected) ? selected : summaries[0]?.id) ?? null;

   const selectInstall = useCallback(
      (next: InstallId) => {
         void updateApp({ selection: { installIds: { [targetId]: next } } });
      },
      [targetId, updateApp]
   );

   return { ...installs, summaries, installId, selectInstall };
}
