import type { IpcMainInvokeEvent } from 'electron';

import { chooseLocalExport, chooseLocalImport, openLocalPath } from '@/ipc/dialogs';
import { defineIpcHandlers, type IpcBroadcast } from '@/ipc/host';
import { createPendingIpcEvent } from '@/ipc/pending-event';
import { translate } from '@/lib/messages';
import { createSerialQueue } from '@/lib/state/machine';
import { mapLinkSchemes, parseMapLink, type MapLinkEvent } from '@/modules/maps/contract';
import { mapsIpc } from '@/modules/maps/ipc';
import type { MapService } from '@/modules/maps/main/map-service';
import { onDeepLink, readProtocolsLinkState, setProtocolsLinkRegistered } from '@/modules/shortcuts/main/deep-link';
import { localTargetId } from '@/modules/targets/contract';
import { unsupportedTarget } from '@/modules/targets/main/target-errors';

export function createMapsIpcModule(service: MapService, broadcast: IpcBroadcast) {
   const links = createPendingIpcEvent<MapLinkEvent>((event) => broadcast(mapsIpc.onLinkOpened, event));
   const resolveQueue = createSerialQueue();

   onDeepLink(mapLinkSchemes, (link) => {
      void resolveQueue.run(async () => {
         links.publish(await resolveMapLink(service, link));
      });
   });

   return defineIpcHandlers<typeof mapsIpc, IpcMainInvokeEvent>(mapsIpc, {
      getMapLinkState: () => readProtocolsLinkState(mapLinkSchemes),
      getMetadata: (request) => service.getMetadata(request),
      openMapFolder: (request) => openLocalPath(request.targetId, () => service.getMapPath(request)),
      chooseMapImport: (request, event) =>
         chooseLocalImport(request.targetId, event, [{ name: translate('maps.fileTypes.archive'), extensions: ['zip'] }]),
      importMaps: (request) => (request.targetId === localTargetId ? service.startImport(request) : unsupportedTarget(request)),
      chooseMapExport: (request, event) =>
         chooseLocalExport(request.targetId, request.mapIds.length, event, {
            defaultPath: request.mapIds.length === 1 ? 'map.zip' : 'maps.zip',
            filters: [{ name: translate('maps.fileTypes.archive'), extensions: ['zip'] }]
         }),
      exportMaps: (request) => (request.targetId === localTargetId ? service.startExport(request) : unsupportedTarget(request)),
      setMapLinkRegistered: (request) => setProtocolsLinkRegistered(mapLinkSchemes, request.registered),
      takePendingLink: () => links.take()
   });
}

async function resolveMapLink(service: MapService, link: string): Promise<MapLinkEvent> {
   const parsed = parseMapLink(link);
   if (parsed.status === 'invalid') return { status: 'rejected', issue: parsed.issue };

   const map = await service.lookup(parsed.key);

   return { status: 'ready', key: parsed.key, map };
}
