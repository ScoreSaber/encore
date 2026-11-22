import { Result } from 'better-result';

import { implementTargetApi } from '@/lib/api';
import type { ContentIngestionService } from '@/lib/content/content-ingestion';
import { createProblem, type Problem } from '@/lib/errors';
import { installsApi } from '@/modules/installs/api';
import type { InstallRegistrySnapshot } from '@/modules/installs/contract';
import { launchApi } from '@/modules/launch/api';
import { createDefaultLaunchOptions } from '@/modules/launch/contract';
import { mapsApi } from '@/modules/maps/api';
import { modsApi } from '@/modules/mods/api';
import { createModUploadService, type ModUploadService } from '@/modules/mods/main/mod-upload';
import { operationsApi } from '@/modules/operations/api';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import { questApi } from '@/modules/quest/api';
import { questInstallId } from '@/modules/quest/contract';
import type { QuestDeviceService } from '@/modules/quest/main/quest-device-service';
import { createQuestInstallAppearance, type QuestInstallAppearance } from '@/modules/quest/main/quest-install-appearance';
import { createQuestLaunchService } from '@/modules/quest/main/quest-launch-service';
import { createQuestMapService } from '@/modules/quest/main/quest-map-service';
import type { QuestModService } from '@/modules/quest/main/quest-mod-service';
import type { QuestMutationLock } from '@/modules/quest/main/quest-mutation-lock';
import type { QuestPatchService } from '@/modules/quest/main/quest-patch-service';
import { createQuestUnmodService } from '@/modules/quest/main/quest-unmod-service';
import { isQuestTargetId, type TargetId } from '@/modules/targets/contract';

import { createHash } from 'node:crypto';
import { join } from 'node:path';

export type QuestTarget = ReturnType<typeof createQuestTarget>;

export function createQuestTarget(options: {
   dataPath: string;
   ingestion: ContentIngestionService;
   devices: QuestDeviceService;
   mods: QuestModService;
   operations: OperationRegistry;
   patching: QuestPatchService;
   mutations: QuestMutationLock;
}) {
   const { devices, mods, operations } = options;
   const uploads = new Map<TargetId, ModUploadService>();
   const launch = createQuestLaunchService({ devices, operations, mutations: options.mutations });
   const maps = createQuestMapService({
      ingestion: options.ingestion,
      devices,
      operations,
      mutations: options.mutations,
      dataPath: options.dataPath
   });
   const unmodding = createQuestUnmodService({
      devices,
      operations,
      mutations: options.mutations,
      onUnmodded: (targetId) => mods.forgetScan(targetId)
   });
   const appearance = createQuestInstallAppearance(options.dataPath);
   const listInstalls = (targetId: TargetId) => appearance.applyAll(targetId, devices.listInstalls(targetId));
   const changeAppearance = async (
      targetId: TargetId,
      installId: string,
      change: Parameters<QuestInstallAppearance['update']>[1]
   ): Promise<Result<InstallRegistrySnapshot, Problem>> => {
      if (installId !== questInstallId) return Result.err(createProblem('quest.game.not-found'));
      return (await appearance.update(targetId, change)).map(() => listInstalls(targetId));
   };

   function uploadsFor(targetId: TargetId) {
      const existing = uploads.get(targetId);
      if (existing) return existing;

      const service = createModUploadService({
         dataPath: options.dataPath,
         directoryName: join('quest-mod-uploads', createHash('sha256').update(targetId).digest('hex')),
         extensions: new Set(['.qmod']),
         maxBytes: 128 * 1024 * 1024,
         mods: {
            previewImport: (request) => mods.previewImport({ targetId, ...request }),
            importMod: (request, disposeSource) => mods.importMod({ targetId, ...request }, disposeSource)
         }
      });
      uploads.set(targetId, service);
      return service;
   }

   return {
      listTargets: devices.listTargets,
      subscribe: devices.subscribe,
      dispose: () => {
         launch.dispose();
         maps.dispose();
         unmodding.dispose();
      },
      implementations: [
         implementTargetApi(
            installsApi,
            {
               list: ({ targetId }) => listInstalls(targetId),
               getDetail: ({ targetId, installId }) => {
                  const install = devices.getInstall(targetId, installId);
                  return install && appearance.apply(targetId, install);
               },
               rescan: async ({ targetId }) => {
                  await devices.refresh();
                  return listInstalls(targetId);
               },
               update: ({ targetId, installId, name, color }) =>
                  Result.gen(async function* () {
                     yield* Result.await(changeAppearance(targetId, installId, { name, color }));
                     const install = devices.getInstall(targetId, installId);
                     return install ? Result.ok(appearance.apply(targetId, install)) : Result.err(createProblem('quest.game.not-found'));
                  }),
               setPinned: ({ targetId, installId, pinned }) => changeAppearance(targetId, installId, { pinned }),
               reorder: ({ targetId }) => Result.ok(listInstalls(targetId))
            },
            {
               subscribe: (listener) => {
                  const emit = (targetId: TargetId) => listener({ targetId, snapshot: listInstalls(targetId) });
                  const unsubscribeDevices = devices.subscribe((event) => {
                     if (event.type === 'target-updated') emit(event.target.id);
                  });
                  const unsubscribeAppearance = appearance.subscribe(emit);
                  return () => {
                     unsubscribeDevices();
                     unsubscribeAppearance();
                  };
               }
            }
         ),
         implementTargetApi(
            modsApi,
            {
               getMods: mods.getMods,
               refreshMods: mods.refreshMods,
               syncRepositories: mods.syncRepositories,
               prepareImportUpload: ({ targetId, ...request }) => uploadsFor(targetId).prepareImportUpload(request),
               previewImportUpload: ({ targetId, ...request }) => uploadsFor(targetId).previewImportUpload(request),
               importUpload: ({ targetId, ...request }) => uploadsFor(targetId).importUpload(request),
               discardImportUpload: ({ targetId, ...request }) => uploadsFor(targetId).discardImportUpload(request),
               previewInstall: mods.previewInstall,
               installMods: mods.installMods,
               previewChanges: mods.previewChanges,
               applyChanges: mods.applyChanges,
               previewUninstall: mods.previewUninstall,
               uninstallMods: mods.uninstallMods
            },
            { uploads: { importFile: ({ targetId, ...request }, source) => uploadsFor(targetId).importFile(request, source) } }
         ),
         implementTargetApi(
            operationsApi,
            {
               list: ({ targetId }) => operations.listForTarget(targetId),
               cancel: ({ targetId, ...request }) => operations.cancelForTarget(targetId, request)
            },
            {
               subscribe: (listener) =>
                  operations.subscribeTargets((targetId, snapshot) => {
                     if (isQuestTargetId(targetId)) listener({ targetId, snapshot });
                  })
            }
         ),
         implementTargetApi(
            launchApi,
            {
               getState: ({ targetId }) => launch.getState(targetId),
               getOptions: () => createDefaultLaunchOptions(),
               updateOptions: ({ targetId: _targetId, ...request }) => launch.updateOptions(request),
               preview: ({ targetId, ...request }) => launch.preview(targetId, request),
               start: ({ targetId, ...request }) => launch.start(targetId, request)
            },
            { subscribe: (listener) => launch.subscribe((targetId, snapshot) => listener({ targetId, snapshot })) }
         ),
         implementTargetApi(
            mapsApi,
            {
               list: ({ targetId, ...request }) => maps.list(targetId, request),
               rescan: ({ targetId, ...request }) => maps.rescan(targetId, request),
               getCovers: ({ targetId, ...request }) => maps.getCovers(targetId, request),
               search: ({ targetId, ...request }) => maps.search(targetId, request),
               previewDelete: ({ targetId, ...request }) => maps.previewDelete(targetId, request),
               startDelete: ({ targetId, ...request }) => maps.startDelete(targetId, request),
               startDownload: ({ targetId, ...request }) => maps.startDownload(targetId, request)
            },
            {
               subscribe: (listener) => maps.subscribe((targetId, snapshot) => listener({ targetId, snapshot })),
               uploads: { importArchive: ({ targetId, ...request }, source) => maps.importArchive(targetId, request, source) },
               downloads: { exportArchive: ({ targetId, ...request }) => maps.exportArchive(targetId, request) }
            }
         ),
         implementTargetApi(
            questApi,
            {
               getState: ({ targetId }) => devices.getState(targetId),
               patch: ({ targetId }) => options.patching.patchInstall({ targetId }),
               unmod: unmodding.unmod,
               stopGame: ({ targetId }) => launch.stop(targetId)
            },
            {
               subscribe: (listener) =>
                  devices.subscribe((event) => {
                     if (event.type === 'target-updated') listener({ targetId: event.target.id, snapshot: devices.getState(event.target.id) });
                  })
            }
         )
      ]
   };
}
