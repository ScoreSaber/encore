import type { IpcMainInvokeEvent } from 'electron';

import { showOpenDialog } from '@/ipc/dialogs';
import { defineIpcHandlers } from '@/ipc/host';
import { translate } from '@/lib/messages';
import type { TargetModRequest } from '@/modules/mods/api';
import type { ModImportChoice, ModRepositoryLinkEvent } from '@/modules/mods/contract';
import { modsIpc } from '@/modules/mods/ipc';
import { createGitHubFundingService } from '@/modules/mods/main/github-funding';
import type { ModService } from '@/modules/mods/main/mod-service';
import { importModUpload, uploadModToTarget } from '@/modules/mods/main/mod-upload';
import type { ModRepositoryService } from '@/modules/mods/main/repo-service';
import { localTargetId } from '@/modules/targets/contract';
import type { TargetRegistry } from '@/modules/targets/main/target-registry';

import { basename } from 'node:path';

export function createModsIpcModule(
   service: ModService,
   repositories: ModRepositoryService,
   targets: TargetRegistry,
   takePendingRepositoryLink: () => ModRepositoryLinkEvent | null
) {
   const funding = createGitHubFundingService();

   return defineIpcHandlers<typeof modsIpc, IpcMainInvokeEvent>(modsIpc, {
      getFunding: (request) => funding.get(request),
      getRepositories: () => repositories.getSnapshot(),
      chooseImportSource: (request, event) => chooseImportSource(event, service, request, targets),
      import: (request) =>
         request.targetId === localTargetId
            ? service.importMod({ installId: request.installId, sourcePath: request.sourcePath })
            : importModUpload(targets, request),
      takePendingRepositoryLink,
      refreshRepositories: () => repositories.refresh(),
      previewRepository: (request) => repositories.preview(request),
      addRepository: (request) => repositories.add(request),
      setRepositoryEnabled: (request) => repositories.setEnabled(request),
      setModSourceResolution: (request) => repositories.setSourceResolution(request),
      removeRepository: (request) => repositories.remove(request)
   });
}

async function chooseImportSource(
   event: IpcMainInvokeEvent,
   service: ModService,
   request: TargetModRequest,
   targets: TargetRegistry
): Promise<ModImportChoice> {
   const quest = targets.listTargets().some((target) => target.id === request.targetId && target.capabilities.includes('patch-game'));
   const picked = await showOpenDialog(event, {
      properties: ['openFile'],
      filters: [{ name: translate('mods.import.fileFilter'), extensions: quest ? ['qmod'] : ['dll', 'zip'] }]
   });
   const path = picked.filePaths[0];
   if (picked.canceled || !path) return { status: 'cancelled' };

   const preview =
      request.targetId === localTargetId
         ? await service.previewImport({ installId: request.installId, sourcePath: path })
         : await uploadModToTarget(targets, request, { path, fileName: basename(path) });

   return { status: 'selected', preview };
}
