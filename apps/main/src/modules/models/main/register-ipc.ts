import type { IpcMainInvokeEvent } from 'electron';

import { chooseLocalExport, chooseLocalImport, openLocalPath } from '@/ipc/dialogs';
import { defineIpcHandlers, type IpcBroadcast } from '@/ipc/host';
import { createPendingIpcEvent } from '@/ipc/pending-event';
import { translate } from '@/lib/messages';
import { createSerialQueue } from '@/lib/state/machine';
import { modelLinkScheme, modelTypes, parseModelLink, type ModelLinkEvent } from '@/modules/models/contract';
import { modelsIpc } from '@/modules/models/ipc';
import { modelExtension } from '@/modules/models/main/model-paths';
import type { ModelService } from '@/modules/models/main/model-service';
import { onDeepLink, readProtocolLinkState, setProtocolLinkRegistered } from '@/modules/shortcuts/main/deep-link';
import { localTargetId } from '@/modules/targets/contract';
import { unsupportedTarget } from '@/modules/targets/main/target-errors';

const modelFileExtensions = modelTypes.map((type) => modelExtension(type).slice(1));

export function createModelsIpcModule(service: ModelService, broadcast: IpcBroadcast) {
   const links = createPendingIpcEvent<ModelLinkEvent>((event) => broadcast(modelsIpc.onLinkOpened, event));
   const resolveQueue = createSerialQueue();

   onDeepLink([modelLinkScheme], (link) => {
      void resolveQueue.run(async () => {
         links.publish(await resolveModelLink(service, link));
      });
   });

   return defineIpcHandlers<typeof modelsIpc, IpcMainInvokeEvent>(modelsIpc, {
      getModelLinkState: () => readProtocolLinkState(modelLinkScheme),
      openModelFolder: (request) => openLocalPath(request.targetId, () => service.getModelPath(request), 'reveal'),
      chooseModelImport: (request, event) => chooseLocalImport(request.targetId, event, [{ name: 'Model', extensions: modelFileExtensions }]),
      importModels: (request) => (request.targetId === localTargetId ? service.startImport(request) : unsupportedTarget(request)),
      chooseModelExport: (request, event) =>
         chooseLocalExport(request.targetId, request.modelIds.length, event, {
            defaultPath: request.modelIds.length === 1 ? 'model.zip' : 'models.zip',
            filters: [{ name: translate('models.fileTypes.archive'), extensions: ['zip'] }]
         }),
      exportModels: (request) => (request.targetId === localTargetId ? service.startExport(request) : unsupportedTarget(request)),
      setModelLinkRegistered: (request) => setProtocolLinkRegistered(modelLinkScheme, request.registered),
      takePendingLink: () => links.take()
   });
}

async function resolveModelLink(service: ModelService, link: string): Promise<ModelLinkEvent> {
   const parsed = parseModelLink(link);
   if (parsed.status === 'invalid') return { status: 'rejected', issue: parsed.issue };

   const model = await service.lookup(parsed.id);

   return { status: 'ready', id: parsed.id, model };
}
