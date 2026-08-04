import type { TargetPlaylistCollectionRequest } from '@/modules/playlists/api';
import { InstallPlaylistsPanel } from '@/modules/playlists/renderer/install-playlists-panel';
import { useInstallPlaylists } from '@/modules/playlists/renderer/use-install-playlists';

export function InstallPlaylistsTab({
   request,
   active,
   onManageSharedContent
}: {
   request: TargetPlaylistCollectionRequest;
   active: boolean;
   onManageSharedContent: () => void;
}) {
   const playlists = useInstallPlaylists(request);

   return active ? <InstallPlaylistsPanel request={request} playlists={playlists} onManageSharedContent={onManageSharedContent} /> : null;
}
