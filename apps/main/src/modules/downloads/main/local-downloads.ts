import { createDownloadService } from '@/modules/downloads/main/download-service';
import { requestMetaAuthToken } from '@/modules/downloads/main/meta-auth-window';
import { createOculusDownloader } from '@/modules/downloads/main/oculus-downloader';
import { createSteamDownloader } from '@/modules/downloads/main/steam-downloader';
import { createVersionCatalog } from '@/modules/downloads/main/version-catalog';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import { storeKinds } from '@/modules/stores/contract';
import type { AppLogWriter } from '@/modules/support/main/app-log';

export function createLocalDownloads(options: {
   dataPath: string;
   settingsStore: SettingsStore;
   registry: InstallRegistry;
   operations: OperationRegistry;
   log: AppLogWriter;
   ensureProton: () => Promise<boolean>;
}) {
   return createDownloadService({
      settingsStore: options.settingsStore,
      registry: options.registry,
      operations: options.operations,
      log: options.log,
      ensureProton: options.ensureProton,
      catalog: createVersionCatalog({ dataPath: options.dataPath }),
      stores: process.platform === 'win32' ? [...storeKinds] : ['steam'],
      steam: createSteamDownloader({ operations: options.operations }),
      oculus: createOculusDownloader({ operations: options.operations, requestToken: requestMetaAuthToken })
   });
}
