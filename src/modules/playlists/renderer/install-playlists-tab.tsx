import type { TargetPlaylistCollectionRequest } from '@/modules/playlists/api';
import { InstallPlaylistsPanel } from '@/modules/playlists/renderer/install-playlists-panel';
import { useInstallPlaylists } from '@/modules/playlists/renderer/use-install-playlists';

export function InstallPlaylistsTab({ request, active }: { request: TargetPlaylistCollectionRequest; active: boolean }) {
   const playlists = useInstallPlaylists(request);

   return active ? <InstallPlaylistsPanel request={request} playlists={playlists} /> : null;
}
