import type { AnyIpcEventDefinition, IpcDescriptor, IpcEventPayload, IpcInvokeArgs, IpcRequestDefinition, IpcResponse } from '@/ipc/core';
import { createTargetIpcDescriptor } from '@/ipc/target-api';
import { appIpc } from '@/modules/app/ipc';
import { bsmanagerIpc } from '@/modules/bsmanager/ipc';
import { downloadsApi } from '@/modules/downloads/api';
import { installsApi } from '@/modules/installs/api';
import { installsIpc } from '@/modules/installs/ipc';
import { launchApi } from '@/modules/launch/api';
import { mapsApi } from '@/modules/maps/api';
import { mapsIpc } from '@/modules/maps/ipc';
import { modelsApi } from '@/modules/models/api';
import { modelsIpc } from '@/modules/models/ipc';
import { modsApi } from '@/modules/mods/api';
import { modsIpc } from '@/modules/mods/ipc';
import { operationsApi } from '@/modules/operations/api';
import { playlistsApi } from '@/modules/playlists/api';
import { playlistsIpc } from '@/modules/playlists/ipc';
import { receiverIpc } from '@/modules/receiver/ipc';
import { settingsIpc } from '@/modules/settings/ipc';
import { sharedContentApi } from '@/modules/shared-content/api';
import { sharedContentIpc } from '@/modules/shared-content/ipc';
import { shortcutsIpc } from '@/modules/shortcuts/ipc';
import { supportApi } from '@/modules/support/api';
import { supportIpc } from '@/modules/support/ipc';
import { targetsIpc } from '@/modules/targets/ipc';
import { updatesIpc } from '@/modules/updates/ipc';

type IpcClient<Descriptor extends IpcDescriptor> = {
   [Method in keyof Descriptor]: Descriptor[Method] extends IpcRequestDefinition
      ? (...args: IpcInvokeArgs<Descriptor[Method]>) => Promise<IpcResponse<Descriptor[Method]>>
      : Descriptor[Method] extends AnyIpcEventDefinition
        ? (listener: (payload: IpcEventPayload<Descriptor[Method]>) => void) => () => void
        : never;
};

type IpcInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
type IpcSubscribe = (channel: string, listener: (payload: unknown) => void) => () => void;

type IpcClients<Descriptors extends Record<string, IpcDescriptor>> = {
   [Domain in keyof Descriptors]: IpcClient<Descriptors[Domain]>;
};

const ipcDescriptors = {
   app: appIpc,
   settings: settingsIpc,
   receiver: receiverIpc,
   targets: targetsIpc,
   installs: { ...createTargetIpcDescriptor(installsApi), ...installsIpc },
   maps: { ...createTargetIpcDescriptor(mapsApi), ...mapsIpc },
   models: { ...createTargetIpcDescriptor(modelsApi), ...modelsIpc },
   playlists: { ...createTargetIpcDescriptor(playlistsApi), ...playlistsIpc },
   sharedContent: { ...createTargetIpcDescriptor(sharedContentApi), ...sharedContentIpc },
   bsmanager: bsmanagerIpc,
   downloads: createTargetIpcDescriptor(downloadsApi),
   launch: createTargetIpcDescriptor(launchApi),
   mods: { ...createTargetIpcDescriptor(modsApi), ...modsIpc },
   shortcuts: shortcutsIpc,
   support: { ...createTargetIpcDescriptor(supportApi), ...supportIpc },
   update: updatesIpc,
   operations: createTargetIpcDescriptor(operationsApi)
};

function bindIpc<Descriptors extends Record<string, IpcDescriptor>>(descriptors: Descriptors, invoke: IpcInvoke, subscribe: IpcSubscribe) {
   // object iteration erases the descriptor keys; keep the only assertion at this boundary
   return Object.fromEntries(
      Object.entries(descriptors).map(([domain, descriptor]) => [
         domain,
         Object.fromEntries(
            Object.entries(descriptor).map(([method, definition]) => [
               method,
               definition.kind === 'event'
                  ? (listener: (payload: unknown) => void) => subscribe(definition.channel, listener)
                  : (...args: unknown[]) => invoke(definition.channel, ...args)
            ])
         )
      ])
   ) as IpcClients<Descriptors>;
}

export function createEncoreApi(platform: NodeJS.Platform, invoke: IpcInvoke, subscribe: IpcSubscribe) {
   return { platform, ...bindIpc(ipcDescriptors, invoke, subscribe) };
}

export type EncoreApi = ReturnType<typeof createEncoreApi>;
