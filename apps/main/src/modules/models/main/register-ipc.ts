import { shell, type IpcMainInvokeEvent } from 'electron';

import { showOpenDialog, showSaveDialog } from '@/ipc/dialogs';
import { broadcastIpcEvent, defineIpcHandlers } from '@/ipc/main';
import { createPendingIpcEvent } from '@/ipc/pending-event';
import type { TargetModelCollectionRequest, TargetModelDetailRequest, TargetModelSelectionRequest } from '@/modules/models/api';
import {
   modelLinkScheme,
   modelTypes,
   parseModelLink,
   type ModelExportChoice,
   type ModelImportChoice,
   type ModelLinkEvent,
   type ModelLinkProtocolResult,
   type ModelLinkProtocolState,
   type ModelOpenFolderResult
} from '@/modules/models/contract';
import { modelsIpc } from '@/modules/models/ipc';
import { modelExtension } from '@/modules/models/main/model-paths';
import type { ModelService } from '@/modules/models/main/model-service';
import { canUnregisterProtocol, isProtocolRegistered, onDeepLink, setProtocolRegistered } from '@/modules/shortcuts/main/deep-link';
import { localTargetId } from '@/modules/targets/contract';
import { unsupportedTarget } from '@/modules/targets/main/target-errors';

const modelFileExtensions = modelTypes.map((type) => modelExtension(type).slice(1));

export function createModelsIpcModule(service: ModelService) {
   const links = createPendingIpcEvent<ModelLinkEvent>((event) => broadcastIpcEvent(modelsIpc.onLinkOpened, event));

   onDeepLink([modelLinkScheme], (link) => {
      void resolveModelLink(service, link).then((event) => {
         links.publish(event);
      });
   });

   return defineIpcHandlers(modelsIpc, {
      getModelLinkState: () => readLinkState(),
      openModelFolder: (_event, request) => openModelFolder(service, request),
      chooseModelImport,
      importModels: (_event, request) =>
         request.targetId === localTargetId ? service.startImport(request) : unsupportedTarget('models', 'manage models', request),
      chooseModelExport,
      exportModels: (_event, request) =>
         request.targetId === localTargetId ? service.startExport(request) : unsupportedTarget('models', 'manage models', request),
      setModelLinkRegistered: (_event, request) => setLinkRegistered(request.registered),
      takePendingLink: () => links.take()
   });
}

async function openModelFolder(service: ModelService, request: TargetModelDetailRequest): Promise<ModelOpenFolderResult> {
   if (request.targetId !== localTargetId) return { status: 'unsupported' };

   const modelPath = await service.getModelPath(request);
   if (!modelPath)
      return {
         status: 'failed',
         message: 'the model is not in this install anymore'
      };

   shell.showItemInFolder(modelPath);

   return { status: 'opened' };
}

async function chooseModelImport(event: IpcMainInvokeEvent, request: TargetModelCollectionRequest): Promise<ModelImportChoice> {
   if (request.targetId !== localTargetId) return { status: 'unsupported' };

   const picked = await showOpenDialog(event, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Model', extensions: modelFileExtensions }]
   });

   if (picked.canceled || picked.filePaths.length === 0) return { status: 'cancelled' };

   return { status: 'selected', paths: picked.filePaths };
}

async function chooseModelExport(event: IpcMainInvokeEvent, request: TargetModelSelectionRequest): Promise<ModelExportChoice> {
   if (request.targetId !== localTargetId) return { status: 'unsupported' };
   if (request.modelIds.length === 0) return { status: 'cancelled' };

   const chosen = await showSaveDialog(event, {
      defaultPath: request.modelIds.length === 1 ? 'model.zip' : 'models.zip',
      filters: [{ name: 'Model archive', extensions: ['zip'] }]
   });

   if (chosen.canceled || !chosen.filePath) return { status: 'cancelled' };

   return { status: 'selected', path: chosen.filePath };
}

function readLinkState(): ModelLinkProtocolState {
   return {
      scheme: modelLinkScheme,
      registered: isProtocolRegistered(modelLinkScheme),
      canUnregister: canUnregisterProtocol()
   };
}

function setLinkRegistered(registered: boolean): ModelLinkProtocolResult {
   setProtocolRegistered(modelLinkScheme, registered);

   return { ok: true, value: readLinkState() };
}

async function resolveModelLink(service: ModelService, link: string): Promise<ModelLinkEvent> {
   const parsed = parseModelLink(link);
   if (parsed.status === 'invalid') return { status: 'rejected', issue: parsed.issue };

   const model = await service.lookup(parsed.id);

   return { status: 'ready', id: parsed.id, model };
}
