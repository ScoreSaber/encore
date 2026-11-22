import { Result } from 'better-result';

import { createProblem } from '@/lib/errors';
import { createUniquePath } from '@/lib/filesystem/path';
import { translate } from '@/lib/messages';
import type {
   DownloadIssue,
   DownloadOutcome,
   DownloadRequestBody,
   DownloadWarning,
   ReadyDownloadPreview,
   UnavailableDownloadPreview
} from '@/modules/downloads/contract';
import type { OculusDownloader } from '@/modules/downloads/main/oculus-downloader';
import type { SteamDownloader } from '@/modules/downloads/main/steam-downloader';
import type { VersionCatalog } from '@/modules/downloads/main/version-catalog';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { OperationId } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import type { StoreKind } from '@/modules/stores/contract';
import type { AppLogWriter } from '@/modules/support/main/app-log';

import { basename, join } from 'node:path';

type DownloadServiceOptions = {
   settingsStore: SettingsStore;
   registry: InstallRegistry;
   operations: OperationRegistry;
   catalog: VersionCatalog;
   stores: StoreKind[];
   steam: SteamDownloader;
   oculus: OculusDownloader;
   log: AppLogWriter;
   ensureProton: () => Promise<boolean>;
};

export function createDownloadService(options: DownloadServiceOptions) {
   async function preview(request: DownloadRequestBody): Promise<ReadyDownloadPreview | UnavailableDownloadPreview> {
      const unavailable = (issue: DownloadIssue, detail?: string) => {
         const unavailablePreview: UnavailableDownloadPreview = { status: 'unavailable', store: request.store, version: request.version, issue };
         if (detail) unavailablePreview.detail = detail;
         return unavailablePreview;
      };

      const catalog = await options.catalog.get();
      if (catalog.status !== 'ready') return unavailable('catalog-unavailable', catalog.problem?.code);

      const entry = catalog.versions.find((candidate) => candidate.version === request.version);
      if (!entry) return unavailable('unknown-version');

      const installRoot = (await options.settingsStore.getSnapshot()).library.installRoot;
      const desiredPath = join(installRoot, `Beat Saber ${entry.version}`);
      const destination = await createUniquePath(desiredPath);
      if (Result.isError(destination)) return unavailable('inspect-failed', destination.error.detail);

      const warnings: DownloadWarning[] = destination.value === desiredPath ? [] : ['name-conflict'];
      const planned = { name: basename(destination.value), installRoot, destinationPath: destination.value, warnings };
      const previewed: Result<ReadyDownloadPreview, { issue: DownloadIssue }> =
         request.store === 'oculus' ? await options.oculus.preview(entry, planned) : await options.steam.preview(entry, planned);

      return Result.isOk(previewed) ? previewed.value : unavailable(previewed.error.issue);
   }

   async function start(request: DownloadRequestBody) {
      const previewed = await preview(request);
      if (previewed.status === 'unavailable') {
         return Result.err(
            createProblem(`downloads.${previewed.issue}`, {
               store: previewed.store,
               version: previewed.version ?? undefined,
               detail: previewed.detail
            })
         );
      }

      const operation = options.operations.start(
         {
            kind: 'download',
            title: translate('downloads.operation', { version: previewed.version }),
            message: previewed.destinationPath,
            progress: { phase: 'preparing', current: 0, percent: 0, unit: 'bytes' },
            metadata: { version: previewed.version, store: previewed.store, destinationPath: previewed.destinationPath }
         },
         (operationId, signal) => run(operationId, previewed, signal)
      );

      return Result.ok(operation);
   }

   async function run(operationId: OperationId, previewed: ReadyDownloadPreview, signal: AbortSignal) {
      const downloaded =
         previewed.store === 'oculus'
            ? await options.oculus.download(previewed, operationId, signal)
            : await options.steam.download(previewed, operationId, signal);
      if (Result.isError(downloaded)) {
         void options.log.warn(`downloads.${previewed.store}: ${downloaded.error.code} ${downloaded.error.message}`);
         return options.operations.fail(operationId, downloaded.error);
      }
      if (signal.aborted) return;

      const registered = await options.registry.register({ source: 'library', path: previewed.destinationPath, store: previewed.store });
      if (Result.isError(registered)) {
         return options.operations.fail(operationId, registered.error);
      }
      if (signal.aborted) return;

      const outcome: DownloadOutcome = {
         installId: registered.value.id,
         store: previewed.store,
         name: registered.value.name,
         path: previewed.destinationPath,
         version: previewed.version,
         bytes: downloaded.value.bytes,
         files: downloaded.value.files,
         protonRequested: await options.ensureProton()
      };
      options.operations.complete(operationId, outcome);
   }

   return {
      getCatalog: async () => ({ ...(await options.catalog.get()), stores: options.stores }),
      refreshCatalog: async () => ({ ...(await options.catalog.refresh()), stores: options.stores }),
      preview,
      start
   };
}
