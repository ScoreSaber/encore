import { z } from 'zod';

import type { AnyIpcEventDefinition, IpcDescriptor, IpcEventDefinition, IpcRequestDefinition } from '@/ipc/core';
import type { DomainApi, ProcedureOutput, SnapshotOutput, TargetCall, TargetCallResult, TargetProcedure, TargetSnapshot } from '@/lib/api';
import { targetIdRequestSchema } from '@/modules/targets/contract';

type TargetIpcProcedure<Procedure extends TargetProcedure> = IpcRequestDefinition<
   TargetCallResult<ProcedureOutput<Procedure>>,
   TargetCall<Procedure>
>;

type TargetIpcDescriptor<Api extends DomainApi> = {
   [Method in keyof Api['procedures']]: TargetIpcProcedure<Api['procedures'][Method]>;
} & (Api extends { snapshot: z.ZodType } ? { onSnapshot: IpcEventDefinition<TargetSnapshot<SnapshotOutput<Api>>> } : Record<never, never>);

export function createTargetIpcDescriptor<Api extends DomainApi>(api: Api): TargetIpcDescriptor<Api>;
export function createTargetIpcDescriptor(api: DomainApi) {
   const descriptor: Record<string, IpcRequestDefinition | AnyIpcEventDefinition> = Object.fromEntries(
      Object.entries(api.procedures).map(([method, procedure]) => [
         method,
         {
            kind: 'request',
            channel: `${api.namespace}:${method}`,
            requestSchema: procedure.input ? targetIdRequestSchema.and(procedure.input) : targetIdRequestSchema
         }
      ])
   );
   if (api.snapshot) descriptor.onSnapshot = targetSnapshotEvent({ namespace: api.namespace, snapshot: api.snapshot });

   return descriptor;
}

type DomainIpcDescriptors<Apis extends Record<string, DomainApi>, Desktop extends Record<string, IpcDescriptor>> = {
   [Domain in keyof Apis | keyof Desktop]: (Domain extends keyof Apis ? TargetIpcDescriptor<Apis[Domain]> : unknown) &
      (Domain extends keyof Desktop ? Desktop[Domain] : unknown);
};

export function createDomainIpcDescriptors<Apis extends Record<string, DomainApi>, Desktop extends Record<string, IpcDescriptor>>(
   apis: Apis,
   desktop: Desktop
): DomainIpcDescriptors<Apis, Desktop>;
export function createDomainIpcDescriptors(apis: Record<string, DomainApi>, desktop: Record<string, IpcDescriptor>) {
   const domains = new Set([...Object.keys(apis), ...Object.keys(desktop)]);
   return Object.fromEntries(
      [...domains].map((domain) => {
         const api = apis[domain];
         return [domain, { ...(api && createTargetIpcDescriptor(api)), ...desktop[domain] }];
      })
   );
}

export function targetSnapshotEvent<Snapshot extends z.ZodType>(api: {
   namespace: string;
   snapshot: Snapshot;
}): IpcEventDefinition<TargetSnapshot<z.output<Snapshot>>> {
   return { kind: 'event', channel: `${api.namespace}:snapshot` };
}
