import { bsmanagerApi } from '@/modules/bsmanager/api';
import { downloadsApi } from '@/modules/downloads/api';
import { filesApi } from '@/modules/files/api';
import { installMirrorApi } from '@/modules/install-mirror/api';
import { installsApi } from '@/modules/installs/api';
import { launchApi } from '@/modules/launch/api';
import { mapsApi, mapSyncApi } from '@/modules/maps/api';
import { modelsApi } from '@/modules/models/api';
import { modsApi } from '@/modules/mods/api';
import { operationsApi } from '@/modules/operations/api';
import { playlistsApi } from '@/modules/playlists/api';
import { questApi } from '@/modules/quest/api';
import { sharedContentApi } from '@/modules/shared-content/api';
import { supportApi } from '@/modules/support/api';
import { updatesApi } from '@/modules/updates/api';

export const targetApis = {
   bsmanager: bsmanagerApi,
   downloads: downloadsApi,
   files: filesApi,
   installMirror: installMirrorApi,
   installs: installsApi,
   launch: launchApi,
   maps: mapsApi,
   mapSync: mapSyncApi,
   models: modelsApi,
   mods: modsApi,
   operations: operationsApi,
   playlists: playlistsApi,
   quest: questApi,
   sharedContent: sharedContentApi,
   support: supportApi,
   updates: updatesApi
};
