import type { TargetMapCollectionRequest } from '@/modules/maps/api';
import { InstallMapsPanel } from '@/modules/maps/renderer/install-maps-panel';
import { useInstallMaps } from '@/modules/maps/renderer/use-install-maps';

export function InstallMapsTab({
   request,
   active,
   onManageSharedContent
}: {
   request: TargetMapCollectionRequest;
   active: boolean;
   onManageSharedContent: () => void;
}) {
   const maps = useInstallMaps(request);

   return active ? <InstallMapsPanel request={request} maps={maps} onManageSharedContent={onManageSharedContent} /> : null;
}
