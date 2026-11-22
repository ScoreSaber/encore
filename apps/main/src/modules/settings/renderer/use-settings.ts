import { useCallback } from 'react';

import { useIsMutating, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';

import { applyAppSettingsPatch, type AppSettingsPatch, type LibrarySettingsPatch } from '@/modules/settings/contract';
import { settingsSnapshotQueryOptions } from '@/modules/settings/renderer/settings-queries';
import { unwrapIpc } from '@/renderer/ipc-result';
import { useOptimisticMutation } from '@/renderer/query/api-query';

type SettingsWriteResult = { ok: true } | { ok: false; error: Error };
type SettingsWrite = { section: 'app'; patch: AppSettingsPatch } | { section: 'library'; patch: LibrarySettingsPatch };

const { queryKey } = settingsSnapshotQueryOptions;

export function useSettings() {
   const queryClient = useQueryClient();
   const settings = useQuery(settingsSnapshotQueryOptions);
   const saving = useIsMutating({ mutationKey: queryKey }) > 0;
   const writeError = useMutationState({ filters: { mutationKey: queryKey }, select: (mutation) => mutation.state.error }).at(-1) ?? null;
   const write = useOptimisticMutation({
      queryKey,
      run: async (write: SettingsWrite) =>
         unwrapIpc(
            write.section === 'app' ? await window.encore.settings.updateApp(write.patch) : await window.encore.settings.updateLibrary(write.patch)
         ),
      preview: (current, write) =>
         current && write.section === 'app' ? { ...current, app: applyAppSettingsPatch(current.app, write.patch) } : current
   });

   const { mutateAsync } = write;
   const update = useCallback(
      (next: SettingsWrite): Promise<SettingsWriteResult> =>
         mutateAsync(next).then(
            () => ({ ok: true }),
            (error: Error) => ({ ok: false, error })
         ),
      [mutateAsync]
   );

   return {
      snapshot: settings.data ?? null,
      loadStatus: settings.isError ? 'error' : settings.isPending ? 'loading' : 'ready',
      loadError: settings.error?.message ?? null,
      saving,
      writeError,
      reload: useCallback(() => queryClient.invalidateQueries({ queryKey }), [queryClient]),
      updateApp: useCallback((patch: AppSettingsPatch) => update({ section: 'app', patch }), [update]),
      updateLibrary: useCallback((patch: LibrarySettingsPatch) => update({ section: 'library', patch }), [update])
   };
}
