import { useInstallEventSync } from '@/modules/installs/renderer/queries';
import { useLaunchEventSync } from '@/modules/launch/renderer/use-install-launch';
import { useMapEventSync } from '@/modules/maps/renderer/map-queries';
import { useModelEventSync } from '@/modules/models/renderer/model-queries';
import { useOperationEventSync } from '@/modules/operations/renderer/queries';
import { usePlaylistEventSync } from '@/modules/playlists/renderer/playlist-queries';
import { useReceiverEventSync } from '@/modules/receiver/renderer/receiver-queries';
import { useSharedContentEventSync } from '@/modules/shared-content/renderer/shared-content-queries';
import { useTargetEventSync } from '@/modules/targets/renderer/target-queries';
import { useUpdateEventSync } from '@/modules/updates/renderer/update-queries';

export function QuerySync() {
   useTargetEventSync();
   useInstallEventSync();
   useLaunchEventSync();
   useOperationEventSync();
   useUpdateEventSync();
   useMapEventSync();
   useModelEventSync();
   usePlaylistEventSync();
   useSharedContentEventSync();
   useReceiverEventSync();

   return null;
}
