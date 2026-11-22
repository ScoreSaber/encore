import type {
   AnyIpcEventDefinition,
   IpcDescriptor,
   IpcEventPayload,
   IpcInvokeArgs,
   IpcRequestDefinition,
   IpcResponse,
   IpcTransportValue
} from '@/ipc/core';
import { createDomainIpcDescriptors } from '@/ipc/target-api';
import { appIpc } from '@/modules/app/ipc';
import { installsIpc } from '@/modules/installs/ipc';
import { mapsIpc } from '@/modules/maps/ipc';
import { modelsIpc } from '@/modules/models/ipc';
import { modsIpc } from '@/modules/mods/ipc';
import { playlistsIpc } from '@/modules/playlists/ipc';
import { questIpc, questLocalIpc } from '@/modules/quest/ipc';
import { receiverIpc } from '@/modules/receiver/ipc';
import { settingsIpc } from '@/modules/settings/ipc';
import { sharedContentIpc } from '@/modules/shared-content/ipc';
import { shortcutsIpc } from '@/modules/shortcuts/ipc';
import { supportIpc } from '@/modules/support/ipc';
import { targetApis } from '@/modules/targets/api';
import { targetsIpc } from '@/modules/targets/ipc';

type IpcClient<Descriptor extends IpcDescriptor> = {
   [Method in keyof Descriptor]: Descriptor[Method] extends IpcRequestDefinition
      ? (...args: IpcInvokeArgs<Descriptor[Method]>) => Promise<IpcResponse<Descriptor[Method]>>
      : Descriptor[Method] extends AnyIpcEventDefinition
        ? (listener: (payload: IpcEventPayload<Descriptor[Method]>) => void) => () => void
        : never;
};

type IpcInvoke = (channel: string, ...args: IpcTransportValue[]) => Promise<IpcTransportValue>;
type IpcSubscribe = (channel: string, listener: (payload: IpcTransportValue) => void) => () => void;

type IpcClients<Descriptors extends Record<string, IpcDescriptor>> = {
   [Domain in keyof Descriptors]: IpcClient<Descriptors[Domain]>;
};

export const ipcDescriptors = createDomainIpcDescriptors(targetApis, {
   app: appIpc,
   settings: settingsIpc,
   receiver: receiverIpc,
   targets: targetsIpc,
   installs: installsIpc,
   maps: mapsIpc,
   models: modelsIpc,
   playlists: playlistsIpc,
   sharedContent: sharedContentIpc,
   mods: modsIpc,
   shortcuts: shortcutsIpc,
   support: supportIpc,
   quest: questIpc,
   questLocal: questLocalIpc
});

function bindIpc<Descriptors extends Record<string, IpcDescriptor>>(
   descriptors: Descriptors,
   invoke: IpcInvoke,
   subscribe: IpcSubscribe
): IpcClients<Descriptors>;
function bindIpc(descriptors: Record<string, IpcDescriptor>, invoke: IpcInvoke, subscribe: IpcSubscribe): object {
   return Object.fromEntries(
      Object.entries(descriptors).map(([domain, descriptor]) => [
         domain,
         Object.fromEntries(
            Object.entries(descriptor).map(([method, definition]) => [
               method,
               definition.kind === 'event'
                  ? (listener: (payload: IpcTransportValue) => void) => subscribe(definition.channel, listener)
                  : (...args: IpcTransportValue[]) => invoke(definition.channel, ...args)
            ])
         )
      ])
   );
}

export function createEncoreApi(platform: NodeJS.Platform, invoke: IpcInvoke, subscribe: IpcSubscribe, runtime: 'desktop' | 'mobile' = 'desktop') {
   return { platform, runtime, ...bindIpc(ipcDescriptors, invoke, subscribe) };
}

export type EncoreApi = ReturnType<typeof createEncoreApi>;
