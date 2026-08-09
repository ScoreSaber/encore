import { Result } from 'better-result';
import type { IpcMainInvokeEvent } from 'electron';

import { showOpenDialog } from '@/ipc/dialogs';
import { defineIpcHandlers } from '@/ipc/main';
import type { ApiModule } from '@/lib/api';
import { hashFile } from '@/lib/content/content-hash';
import { readPathInfo } from '@/lib/filesystem/path';
import { modsApi, type TargetModRequest } from '@/modules/mods/api';
import {
   invalidModAction,
   type ModImportChoice,
   type ModImportPreview,
   type ModImportRequest,
   type ModOperationResult
} from '@/modules/mods/contract';
import { modsIpc } from '@/modules/mods/ipc';
import { createGitHubFundingService } from '@/modules/mods/main/github-funding';
import type { ModService } from '@/modules/mods/main/mod-service';
import type { ModRepositoryService } from '@/modules/mods/main/repo-service';
import { takePendingRepositoryLink } from '@/modules/mods/main/repository-link-intake';
import { localTargetId } from '@/modules/targets/contract';
import { unsupportedTarget } from '@/modules/targets/main/target-errors';
import type { TargetRegistry } from '@/modules/targets/main/target-registry';

import { basename } from 'node:path';

type RemoteModImports = {
   api: ApiModule<typeof modsApi>;
   targets: TargetRegistry;
};

export function createModsIpcModule(service: ModService, repositories: ModRepositoryService, remoteImports: RemoteModImports) {
   const funding = createGitHubFundingService();

   return defineIpcHandlers(modsIpc, {
      getFunding: (_event, request) => funding.get(request),
      getRepositories: () => repositories.getSnapshot(),
      chooseImportSource: (event, request) => chooseImportSource(event, service, request, remoteImports),
      import: (_event, request) =>
         request.targetId === localTargetId
            ? service.importMod({ installId: request.installId, sourcePath: request.sourcePath })
            : importRemoteMod(request, remoteImports),
      takePendingRepositoryLink: () => takePendingRepositoryLink(),
      refreshRepositories: () => repositories.refresh(),
      previewRepository: (_event, request) => repositories.preview(request),
      addRepository: (_event, request) => repositories.add(request),
      setRepositoryEnabled: (_event, request) => repositories.setEnabled(request),
      setModSourceResolution: (_event, request) => repositories.setSourceResolution(request),
      removeRepository: (_event, request) => repositories.remove(request)
   });
}

async function chooseImportSource(
   event: IpcMainInvokeEvent,
   service: ModService,
   request: TargetModRequest,
   remoteImports: RemoteModImports
): Promise<ModImportChoice> {
   const picked = await showOpenDialog(event, {
      properties: ['openFile'],
      filters: [{ name: 'Beat Saber mods', extensions: ['dll', 'zip'] }]
   });
   const selectedPath = picked.filePaths[0];

   if (picked.canceled || !selectedPath) return { status: 'cancelled' };

   const preview =
      request.targetId === localTargetId
         ? await service.previewImport({ installId: request.installId, sourcePath: selectedPath })
         : await uploadRemoteMod(request, selectedPath, remoteImports);

   return { status: 'selected', preview };
}

async function uploadRemoteMod(request: TargetModRequest, sourcePath: string, remoteImports: RemoteModImports): Promise<ModImportPreview> {
   const info = await readPathInfo(sourcePath);
   if (Result.isError(info) || info.value.kind !== 'file') return invalidModAction(request, 'inspect-failed', sourcePath);

   const digest = await hashFile(sourcePath, 'sha256');
   if (Result.isError(digest)) return invalidModAction(request, 'inspect-failed', digest.error.detail);

   const prepared = await remoteImports.targets.callTarget(remoteImports.api, 'prepareImportUpload', request.targetId, {
      installId: request.installId,
      fileName: basename(sourcePath),
      sizeBytes: info.value.sizeBytes,
      sha256: digest.value
   });
   if (prepared.status !== 'ok') {
      return invalidModAction(request, 'unsupported-target', prepared.status === 'unavailable' ? prepared.error.message : undefined);
   }
   if (prepared.value.status === 'invalid') return prepared.value;

   const uploadId = prepared.value.uploadId;
   const uploaded = await remoteImports.targets.uploadTarget(
      remoteImports.api,
      'importFile',
      request.targetId,
      { installId: request.installId, uploadId },
      { path: sourcePath, sizeBytes: info.value.sizeBytes }
   );
   if (uploaded.status !== 'ok') {
      await discardRemoteUpload(request, uploadId, remoteImports);
      return invalidModAction(request, 'inspect-failed', uploaded.status === 'unavailable' ? uploaded.error.message : undefined);
   }

   const preview = await remoteImports.targets.callTarget(remoteImports.api, 'previewImportUpload', request.targetId, {
      installId: request.installId,
      uploadId
   });
   if (preview.status !== 'ok') {
      await discardRemoteUpload(request, uploadId, remoteImports);
      return invalidModAction(request, 'inspect-failed', preview.status === 'unavailable' ? preview.error.message : undefined);
   }
   if (preview.value.status === 'invalid') await discardRemoteUpload(request, uploadId, remoteImports);

   return preview.value;
}

async function discardRemoteUpload(request: TargetModRequest, uploadId: string, remoteImports: RemoteModImports) {
   await remoteImports.targets.callTarget(remoteImports.api, 'discardImportUpload', request.targetId, {
      installId: request.installId,
      uploadId
   });
}

async function importRemoteMod(request: { targetId: string } & ModImportRequest, remoteImports: RemoteModImports): Promise<ModOperationResult> {
   if (!request.uploadId) return unsupportedTarget('mods', 'manage mods', request);

   const imported = await remoteImports.targets.callTarget(remoteImports.api, 'importUpload', request.targetId, {
      installId: request.installId,
      uploadId: request.uploadId
   });
   if (imported.status === 'ok') return imported.value;

   return {
      ok: false,
      error: {
         code: imported.status === 'unsupported' ? 'mods.unsupported-target' : imported.error.code,
         message: imported.status === 'unsupported' ? 'This target cannot manage mods' : imported.error.message
      }
   };
}
