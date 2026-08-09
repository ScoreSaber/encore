import { useQuery } from '@tanstack/react-query';

import type { UpdateSnapshot } from '@/modules/updates/contract';
import { updateSnapshotQueryOptions } from '@/modules/updates/renderer/update-queries';
import { useSnapshotMutation } from '@/renderer/query/use-snapshot-mutation';

const initialUpdate: UpdateSnapshot = {
   status: 'idle'
};

export function useAppUpdate() {
   const options = updateSnapshotQueryOptions;
   const query = useQuery(options);
   const queryKey = options.queryKey;
   const check = useSnapshotMutation({ queryKey, run: () => window.encore.update.checkForUpdates() });
   const install = useSnapshotMutation({ queryKey, run: () => window.encore.update.installDownloaded() });

   return {
      update: query.data ?? initialUpdate,
      checkForUpdates: () => check.mutate(),
      installUpdate: () => install.mutate()
   };
}
