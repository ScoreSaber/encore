import { shell, type IpcMainInvokeEvent } from 'electron';

import { showOpenDialog, showSaveDialog } from '@/app/ipc/dialogs';
import { broadcastIpcEvent, defineIpcHandlers } from '@/app/ipc/main';
import type { TargetMapCollectionRequest, TargetMapDetailRequest, TargetMapSelectionRequest } from '@/modules/maps/api';
import {
   mapLinkSchemes,
   parseMapLink,
   type MapExportChoice,
   type MapImportChoice,
   type MapLinkEvent,
   type MapLinkProtocolResult,
   type MapLinkProtocolState,
   type MapOpenFolderResult
} from '@/modules/maps/contract';
import { mapsIpc } from '@/modules/maps/ipc';
import type { MapService } from '@/modules/maps/main/map-service';
import { canUnregisterProtocol, isProtocolRegistered, onDeepLink, setProtocolRegistered } from '@/modules/shortcuts/main/deep-link';
import { localTargetId } from '@/modules/targets/contract';
import { unsupportedTarget } from '@/modules/targets/main/target-errors';

export function createMapsIpcModule(service: MapService) {
   onDeepLink(mapLinkSchemes, (link) => {
      void resolveMapLink(service, link).then((event) => broadcastIpcEvent(mapsIpc.onLinkOpened, event));
   });

   return defineIpcHandlers(mapsIpc, {
      getMapLinkState: () => readLinkState(),
      openMapFolder: (_event, request) => openMapFolder(service, request),
      chooseMapImport,
      importMaps: (_event, request) =>
         request.targetId === localTargetId ? service.startImport(request) : unsupportedTarget('maps', 'manage maps', request),
      chooseMapExport,
      exportMaps: (_event, request) =>
         request.targetId === localTargetId ? service.startExport(request) : unsupportedTarget('maps', 'manage maps', request),
      setMapLinkRegistered: (_event, request) => setLinkRegistered(request.registered)
   });
}

async function openMapFolder(service: MapService, request: TargetMapDetailRequest): Promise<MapOpenFolderResult> {
   if (request.targetId !== localTargetId) return { status: 'unsupported' };

   const mapPath = await service.getMapPath(request);
   if (!mapPath)
      return {
         status: 'failed',
         message: 'the map is not in this install anymore'
      };

   const failed = await shell.openPath(mapPath);
   return failed ? { status: 'failed', message: failed } : { status: 'opened' };
}

async function chooseMapImport(event: IpcMainInvokeEvent, request: TargetMapCollectionRequest): Promise<MapImportChoice> {
   if (request.targetId !== localTargetId) return { status: 'unsupported' };

   const picked = await showOpenDialog(event, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Map archive', extensions: ['zip'] }]
   });

   if (picked.canceled || picked.filePaths.length === 0) return { status: 'cancelled' };

   return { status: 'selected', paths: picked.filePaths };
}

async function chooseMapExport(event: IpcMainInvokeEvent, request: TargetMapSelectionRequest): Promise<MapExportChoice> {
   if (request.targetId !== localTargetId) return { status: 'unsupported' };
   if (request.mapIds.length === 0) return { status: 'cancelled' };

   const chosen = await showSaveDialog(event, {
      defaultPath: request.mapIds.length === 1 ? 'map.zip' : 'maps.zip',
      filters: [{ name: 'Map archive', extensions: ['zip'] }]
   });

   if (chosen.canceled || !chosen.filePath) return { status: 'cancelled' };

   return { status: 'selected', path: chosen.filePath };
}

function readLinkState(): MapLinkProtocolState {
   return {
      schemes: [...mapLinkSchemes],
      registered: mapLinkSchemes.every((scheme) => isProtocolRegistered(scheme)),
      canUnregister: canUnregisterProtocol()
   };
}

function setLinkRegistered(registered: boolean): MapLinkProtocolResult {
   for (const scheme of mapLinkSchemes) {
      setProtocolRegistered(scheme, registered);
   }

   return { ok: true, value: readLinkState() };
}

async function resolveMapLink(service: MapService, link: string): Promise<MapLinkEvent> {
   const parsed = parseMapLink(link);
   if (parsed.status === 'invalid') return { status: 'rejected', issue: parsed.issue };

   const map = await service.lookup(parsed.key);

   return { status: 'ready', key: parsed.key, map };
}
