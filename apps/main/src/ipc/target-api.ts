import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';

import { ipcTransportValueSchema, type IpcEventDefinition, type IpcRequestDefinition, type IpcTransportValue } from '@/ipc/core';
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
import { localTargetId, targetIdSchema } from '@/modules/targets/contract';

type TargetIpcProcedure<Procedure extends TargetProcedure> = IpcRequestDefinition<
   TargetCallResult<ProcedureOutput<Procedure>>,
   TargetCall<Procedure>,
   'procedure'
>;

type TargetIpcDescriptor<Api extends DomainApi> = {
   [Method in keyof Api['procedures']]: TargetIpcProcedure<Api['procedures'][Method]>;
} & (Api extends { snapshot: z.ZodType } ? { onSnapshot: IpcEventDefinition<TargetSnapshot<SnapshotOutput<Api>>> } : Record<never, never>);

export function createTargetIpcDescriptor<Api extends DomainApi>(api: Api): TargetIpcDescriptor<Api>;
export function createTargetIpcDescriptor(api: DomainApi) {
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

   return descriptor;
}

export type RemoteSnapshotSubscriber = <Snapshot extends z.ZodType>(
   api: { namespace: string; snapshot: Snapshot },
   listener: (event: TargetSnapshot<z.output<Snapshot>>) => void
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
   module.subscribeJson((snapshot) => broadcast(event, { targetId: localTargetId, snapshot }));
   subscribeRemote(module.api, (snapshot) => broadcast(event, snapshot));
}

function createErasedTargetIpcModule(local: TargetApiModule, dispatch: TargetDispatcher) {
   const descriptor: Record<string, IpcRequestDefinition> = createTargetIpcDescriptor(local.api);
   const invokeDispatch = z
      .function({
         input: [z.custom<TargetApiModule>(), z.string(), targetIdSchema, z.record(z.string(), ipcTransportValueSchema)]
      })
      .parse(dispatch);

   return Object.keys(local.api.procedures).map((method) => {
      const definition = descriptor[method];
      if (!definition) throw new Error(`Unknown target IPC procedure: ${local.api.namespace}.${method}`);

      return {
         definition,
         handler: async (_event: IpcMainInvokeEvent, ...args: IpcTransportValue[]) => {
            const call = z.object({ targetId: targetIdSchema }).loose().parse(args[0]);
            const { targetId, ...input } = call;
            return ipcTransportValueSchema.parse(await invokeDispatch(local, method, targetId, input));
         }
      };
   });
}
