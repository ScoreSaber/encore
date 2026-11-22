import { useEffect } from 'react';

import { hashKey, useQueryClient, type DataTag, type QueryKey } from '@tanstack/react-query';

import { installListQueryOptions } from '@/modules/installs/renderer/queries';
import { launchStateQueryOptions } from '@/modules/launch/renderer/launch-queries';
import { mapListQueryOptions } from '@/modules/maps/renderer/map-queries';
import { modelListQueryOptions } from '@/modules/models/renderer/model-queries';
import { operationListQueryOptions, upsertOperation } from '@/modules/operations/renderer/queries';
import { playlistListQueryOptions } from '@/modules/playlists/renderer/playlist-queries';
import { questStateQueryOptions } from '@/modules/quest/renderer/quest-queries';
import { receiverStateQueryOptions } from '@/modules/receiver/renderer/receiver-queries';
import { settingsSnapshotQueryOptions } from '@/modules/settings/renderer/settings-queries';
import { sharedContentListQueryOptions } from '@/modules/shared-content/renderer/shared-content-queries';
import { applyTargetEvent, targetListQueryOptions } from '@/modules/targets/renderer/target-queries';
import { updateStateQueryOptions } from '@/modules/updates/renderer/use-update';
import { installKey, targetKey } from '@/renderer/query/api-query';

export function QuerySync() {
   const queryClient = useQueryClient();

   useEffect(() => {
      const { encore } = window;

      function updateExisting<Data>(queryKey: DataTag<QueryKey, Data, Error>, next: (current: Data) => Data) {
         const state = queryClient.getQueryState(queryKey);
         if (state?.data !== undefined) {
            queryClient.setQueryData(queryKey, (current) => (current === undefined ? current : next(current)));
         }
      }

      function replace<Data>(queryKey: DataTag<QueryKey, Data, Error>, snapshot: Data, siblings?: QueryKey) {
         if (queryClient.getQueryState(queryKey)) queryClient.setQueryData(queryKey, () => snapshot);
         if (siblings) void queryClient.invalidateQueries({ queryKey: siblings, predicate: (query) => query.queryHash !== hashKey(queryKey) });
      }

      const unsubscribes = [
         encore.targets.onEvent((event) => {
            const previous = queryClient.getQueryData(targetListQueryOptions.queryKey);
            updateExisting(targetListQueryOptions.queryKey, (targets) => applyTargetEvent(targets, event));
            if (event.type !== 'target-updated' || event.target.status !== 'ready') return;
            const reconnected = previous?.some((target) => target.id === event.target.id && target.status !== 'ready');
            if (reconnected) void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[1] === event.target.id });
         }),
         encore.operations.onSnapshot(({ targetId, snapshot }) =>
            updateExisting(operationListQueryOptions(targetId).queryKey, (operations) => upsertOperation(operations, snapshot))
         ),
         encore.installs.onSnapshot(({ targetId, snapshot }) =>
            replace(installListQueryOptions(targetId).queryKey, snapshot, targetKey('installs', targetId))
         ),
         encore.launch.onSnapshot(({ targetId, snapshot }) => replace(launchStateQueryOptions(targetId).queryKey, snapshot)),
         encore.maps.onSnapshot(({ targetId, snapshot }) =>
            replace(mapListQueryOptions({ targetId, installId: snapshot.installId }).queryKey, snapshot)
         ),
         encore.models.onSnapshot(({ targetId, snapshot }) =>
            replace(modelListQueryOptions({ targetId, installId: snapshot.installId }).queryKey, snapshot)
         ),
         encore.playlists.onSnapshot(({ targetId, snapshot }) => {
            const scope = { targetId, installId: snapshot.installId };
            replace(playlistListQueryOptions(scope).queryKey, snapshot, installKey('playlists', scope));
         }),
         encore.sharedContent.onSnapshot(({ targetId, snapshot }) =>
            replace(
               sharedContentListQueryOptions({ targetId, installId: snapshot.installId }).queryKey,
               snapshot,
               targetKey('sharedContent', targetId, 'getOverview')
            )
         ),
         encore.updates.onSnapshot(({ targetId, snapshot }) => replace(updateStateQueryOptions(targetId).queryKey, snapshot)),
         encore.quest.onSnapshot(({ targetId, snapshot }) => replace(questStateQueryOptions(targetId).queryKey, snapshot)),
         encore.receiver.onStateChanged((state) => replace(receiverStateQueryOptions.queryKey, state, settingsSnapshotQueryOptions.queryKey))
      ];

      return () => {
         for (const unsubscribe of unsubscribes) unsubscribe();
      };
   }, [queryClient]);

   return null;
}
