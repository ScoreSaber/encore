import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';

import type { IpcEventDefinition, IpcRequestDefinition } from '@/app/ipc/core';
import type { IpcMainModule } from '@/app/ipc/main';
import {
   hasSnapshotStream,
   type DomainApi,
   ProcedureOutput,
   SnapshotOutput,
   TargetApiModule,
   TargetCall,
   TargetCallResult,
   TargetDispatcher,
   TargetProcedure,
   TargetSnapshot
} from '@/lib/api';
import { localTargetId, targetIdSchema, type TargetId } from '@/modules/targets/contract';

type TargetIpcProcedure<Procedure extends TargetProcedure> = IpcRequestDefinition<
   TargetCallResult<ProcedureOutput<Procedure>>,
   TargetCall<Procedure>,
   'procedure'
>;

type TargetIpcDescriptor<Api extends DomainApi> = {
   [Method in keyof Api['procedures']]: TargetIpcProcedure<Api['procedures'][Method]>;
} & (Api extends { snapshot: z.ZodType } ? { onSnapshot: IpcEventDefinition<TargetSnapshot<SnapshotOutput<Api>>> } : Record<never, never>);

export function createTargetIpcDescriptor<Api extends DomainApi>(api: Api) {
   const descriptor: Record<string, IpcRequestDefinition | IpcEventDefinition> = Object.fromEntries(
      Object.entries(api.procedures).map(([method, procedure]) => [
         method,
         {
            kind: 'procedure',
            channel: `${api.namespace}:${method}`,
            requestSchema: procedure.input ? z.object({ targetId: targetIdSchema }).and(procedure.input) : z.object({ targetId: targetIdSchema })
         }
      ])
   );
   if (api.snapshot) descriptor.onSnapshot = { kind: 'event', channel: `${api.namespace}:snapshot` };

   return descriptor as TargetIpcDescriptor<Api>;
}

export type RemoteSnapshotSubscriber = <Api extends DomainApi & { snapshot: z.ZodType }>(
   api: Api,
   listener: (event: TargetSnapshot<SnapshotOutput<Api>>) => void
) => () => void;

type SnapshotBroadcaster = <Snapshot>(definition: IpcEventDefinition<TargetSnapshot<Snapshot>>, snapshot: TargetSnapshot<Snapshot>) => void;

export function createTargetIpcModules(
   modules: readonly TargetApiModule[],
   dispatch: TargetDispatcher,
   subscribeRemote: RemoteSnapshotSubscriber,
   broadcast: SnapshotBroadcaster
) {
   for (const module of modules) forwardSnapshots(module, subscribeRemote, broadcast);

   return modules.map((module) => createErasedTargetIpcModule(module, dispatch));
}

function forwardSnapshots(module: TargetApiModule, subscribeRemote: RemoteSnapshotSubscriber, broadcast: SnapshotBroadcaster) {
   if (!hasSnapshotStream(module)) return;

   const event = createTargetIpcDescriptor(module.api).onSnapshot;
   const subscribe = module.subscribe as (listener: (snapshot: unknown) => void) => () => void;
   subscribe((snapshot) => broadcast(event, { targetId: localTargetId, snapshot }));
   subscribeRemote(module.api, (snapshot) => broadcast(event, snapshot));
}

function createErasedTargetIpcModule(local: TargetApiModule, dispatch: TargetDispatcher) {
   const descriptor: Record<string, IpcRequestDefinition> = createTargetIpcDescriptor(local.api);

   return Object.keys(local.api.procedures).map((method) => [
      descriptor[method],
      (_event: IpcMainInvokeEvent, call: { targetId: TargetId } & object) => {
         const { targetId, ...input } = call;
         return Reflect.apply(dispatch, undefined, [local, method, targetId, input]);
      }
   ]) as IpcMainModule;
}
