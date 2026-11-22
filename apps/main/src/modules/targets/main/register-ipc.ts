import { z } from 'zod';

import type { IpcTransportValue } from '@/ipc/core';
import { defineIpcHandlers, type IpcBroadcast, type IpcModule } from '@/ipc/host';
import { createTargetIpcDescriptor, targetSnapshotEvent } from '@/ipc/target-api';
import type { DomainApi } from '@/lib/api';
import { targetApis } from '@/modules/targets/api';
import { targetIdRequestSchema } from '@/modules/targets/contract';
import { targetsIpc } from '@/modules/targets/ipc';
import type { TargetRegistry } from '@/modules/targets/main/target-registry';

const targetCallSchema = targetIdRequestSchema.catchall(z.custom<IpcTransportValue>());

export function createTargetsIpcModule(registry: TargetRegistry, broadcast: IpcBroadcast): IpcModule {
   registry.subscribe((event) => broadcast(targetsIpc.onEvent, event));

   return [
      ...defineIpcHandlers(targetsIpc, {
         list: () => registry.listTargets()
      }),
      ...Object.values<DomainApi>(targetApis).flatMap((api) => {
         if (api.snapshot) {
            const event = targetSnapshotEvent({ namespace: api.namespace, snapshot: api.snapshot });
            registry.subscribeSnapshots(api.namespace, (snapshot) => broadcast(event, snapshot));
         }

         const descriptor = createTargetIpcDescriptor(api);
         return Object.keys(api.procedures).flatMap((method) => {
            const definition = descriptor[method];
            if (!definition) return [];

            return [
               {
                  definition,
                  handle: async (request: IpcTransportValue) => {
                     const { targetId, ...input } = targetCallSchema.parse(request);
                     return registry.dispatch(api, method, targetId, input);
                  }
               }
            ];
         });
      })
   ];
}
