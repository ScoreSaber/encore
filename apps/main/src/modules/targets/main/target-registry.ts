import { Result } from 'better-result';
import { z } from 'zod';

import type { IpcTransportValue } from '@/ipc/core';
import {
   apiInputSchema,
   getDownload,
   getProcedure,
   getUpload,
   type ApiImplementation,
   type ApiInput,
   type ApiDownload,
   type ApiDownloadMethod,
   type ApiMethod,
   type ApiUpload,
   type ApiUploadMethod,
   type DomainApi,
   type DownloadInput,
   type ProcedureInput,
   type ProcedureOutput,
   type TargetCallResult,
   type TargetSnapshot,
   type UploadInput
} from '@/lib/api';
import { createProblem } from '@/lib/errors';
import type { QuestHeadsets } from '@/modules/quest/main/quest-headsets';
import type { QuestTarget } from '@/modules/quest/main/quest-target';
import type { RemoteReceiverClient } from '@/modules/receiver/main/remote-receiver-client';
import { isQuestTargetId, localTargetId, type Target, type TargetCapability, type TargetEvent, type TargetId } from '@/modules/targets/contract';
import { getLocalTarget } from '@/modules/targets/main/local-target';

import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type TargetRegistry = ReturnType<typeof createTargetRegistry>;

export function createTargetRegistry(options: {
   local?: readonly ApiImplementation[];
   quest?: QuestTarget;
   headsets?: QuestHeadsets;
   remote: RemoteReceiverClient;
}) {
   const local = new Map((options.local ?? []).map((implementation) => [implementation.api.namespace, implementation]));
   const quest = new Map((options.quest?.implementations ?? []).map((implementation) => [implementation.api.namespace, implementation]));
   const headsets = options.headsets;

   function listTargets(): Target[] {
      return [
         ...(options.local ? [getLocalTarget()] : []),
         ...(headsets?.listTargets() ?? options.quest?.listTargets() ?? []),
         ...options.remote.listTargets().filter((target) => !headsets || target.kind !== 'quest')
      ];
   }

   function routeFor(targetId: TargetId) {
      if (!isQuestTargetId(targetId) || !headsets) return { targetId, local: isQuestTargetId(targetId) };
      return headsets.route(targetId);
   }

   function hostOf(targetId: TargetId) {
      if (targetId === localTargetId) return null;
      const route = routeFor(targetId);
      return route && !route.local ? options.remote.hostOf(route.targetId) : null;
   }

   const supports = (targetId: TargetId, capability: TargetCapability) =>
      listTargets().some((target) => target.id === targetId && target.capabilities.includes(capability));

   function subscribe(listener: (event: TargetEvent) => void) {
      const unsubscribeQuest = (headsets ?? options.quest)?.subscribe(listener);
      const unsubscribeRemote = options.remote.subscribe((event) => {
         if (!headsets?.isRelayedQuest(event)) listener(event);
      });

      return () => {
         unsubscribeQuest?.();
         unsubscribeRemote();
      };
   }

   function implementations(targetId: TargetId) {
      if (targetId === localTargetId) return local;
      const route = routeFor(targetId);
      if (route?.local) return quest;

      return null;
   }

   async function forward(
      api: DomainApi,
      method: string,
      targetId: TargetId,
      input: ApiInput
   ): Promise<{ remote: boolean; result: TargetCallResult<IpcTransportValue> }> {
      const procedure = getProcedure(api, method);
      if (!supports(targetId, procedure.capability))
         return { remote: false, result: { status: 'unsupported', targetId, capability: procedure.capability } };

      const inProcess = implementations(targetId);
      if (inProcess) {
         const handler = inProcess.get(api.namespace)?.procedures.get(method);
         const result: TargetCallResult<IpcTransportValue> = handler
            ? { status: 'ok', targetId, value: await handler(targetId, input) }
            : { status: 'unsupported', targetId, capability: procedure.capability };
         return { remote: false, result };
      }

      const routed = routeFor(targetId)?.targetId ?? targetId;
      const remote = await options.remote.callTarget(routed, api.namespace, method, procedure.capability, input);
      return { remote: true, result: { ...remote, targetId } };
   }

   async function dispatch(api: DomainApi, method: string, targetId: TargetId, input: ApiInput): Promise<TargetCallResult<IpcTransportValue>> {
      const { remote, result } = await forward(api, method, targetId, input);
      if (!remote || result.status !== 'ok' || getProcedure(api, method).output.safeParse(result.value).success) return result;

      return { status: 'unavailable', targetId, error: createProblem('targets.response.invalid', { cause: `${api.namespace}.${method}` }) };
   }

   async function callTarget<Api extends DomainApi, Method extends ApiMethod<Api>>(
      api: Api,
      method: Method,
      targetId: TargetId,
      input: ProcedureInput<Api['procedures'][Method]>
   ): Promise<TargetCallResult<ProcedureOutput<Api['procedures'][Method]>>> {
      const { result } = await forward(api, method, targetId, apiInputSchema.parse(input));
      if (result.status !== 'ok') return result;

      const output = getProcedure(api, method).output.pipe(z.custom<ProcedureOutput<Api['procedures'][Method]>>()).safeParse(result.value);
      return output.success
         ? { status: 'ok', targetId, value: output.data }
         : { status: 'unavailable', targetId, error: createProblem('targets.response.invalid', { cause: `${api.namespace}.${method}` }) };
   }

   async function uploadTarget<Api extends DomainApi, Method extends ApiUploadMethod<Api>>(
      api: Api,
      method: Method,
      targetId: TargetId,
      input: UploadInput<ApiUpload<Api, Method>>,
      file: { path: string; sizeBytes: number },
      signal?: AbortSignal
   ): Promise<TargetCallResult<void>> {
      const upload = getUpload(api, method);
      if (!supports(targetId, upload.capability)) return { status: 'unsupported', targetId, capability: upload.capability };

      const inProcess = implementations(targetId);
      if (!inProcess) {
         const uploaded = await options.remote.uploadTarget(
            routeFor(targetId)?.targetId ?? targetId,
            api.namespace,
            method,
            upload,
            input,
            file,
            signal
         );
         return { ...uploaded, targetId };
      }

      const handler = inProcess.get(api.namespace)?.uploads.get(method);
      if (!handler) return { status: 'unsupported', targetId, capability: upload.capability };

      const uploaded = await handler(targetId, apiInputSchema.parse(input), createReadStream(file.path, { signal }));
      return Result.isOk(uploaded)
         ? { status: 'ok', targetId, value: undefined }
         : { status: 'unavailable', targetId, error: { code: uploaded.error.code, message: uploaded.error.message } };
   }

   async function downloadTarget<Api extends DomainApi, Method extends ApiDownloadMethod<Api>>(
      api: Api,
      method: Method,
      targetId: TargetId,
      input: DownloadInput<ApiDownload<Api, Method>>,
      destinationPath: string,
      signal?: AbortSignal
   ): Promise<TargetCallResult<{ sizeBytes: number }>> {
      const download = getDownload(api, method);
      if (!supports(targetId, download.capability)) return { status: 'unsupported', targetId, capability: download.capability };

      const inProcess = implementations(targetId);
      if (!inProcess) {
         const downloaded = await options.remote.downloadTarget(
            routeFor(targetId)?.targetId ?? targetId,
            api.namespace,
            method,
            download,
            input,
            destinationPath,
            signal
         );
         return { ...downloaded, targetId };
      }

      const handler = inProcess.get(api.namespace)?.downloads.get(method);
      if (!handler) return { status: 'unsupported', targetId, capability: download.capability };

      const opened = await handler(targetId, apiInputSchema.parse(input));
      if (Result.isError(opened)) return { status: 'unavailable', targetId, error: { code: opened.error.code, message: opened.error.message } };
      const written = await Result.tryPromise(() => pipeline(Readable.from(opened.value), createWriteStream(destinationPath), { signal }));
      if (Result.isError(written))
         return { status: 'unavailable', targetId, error: createProblem('targets.download.failed', { cause: written.error }) };
      const info = await Result.tryPromise(() => stat(destinationPath));
      return { status: 'ok', targetId, value: { sizeBytes: Result.isOk(info) ? info.value.size : 0 } };
   }

   function subscribeSnapshots(namespace: string, listener: (event: TargetSnapshot<IpcTransportValue>) => void) {
      const fromHeadset = (event: TargetSnapshot<IpcTransportValue>) => {
         if (!headsets) return listener(event);
         const headset = headsets.headsetFor(event.targetId);
         if (headset) listener({ ...event, targetId: headset });
         else if (!isQuestTargetId(event.targetId) && !event.targetId.includes('/')) listener(event);
      };
      const unsubscribers = [
         local.get(namespace)?.subscribe?.(listener),
         quest.get(namespace)?.subscribe?.(fromHeadset),
         options.remote.subscribeSnapshots(namespace, fromHeadset)
      ];

      return () => {
         for (const unsubscribe of unsubscribers) unsubscribe?.();
      };
   }

   return {
      listTargets,
      dispatch,
      callTarget,
      uploadTarget,
      downloadTarget,
      hostOf,
      serve: (implementation: ApiImplementation) => {
         local.set(implementation.api.namespace, implementation);
      },
      served: () => [...local.values()],
      subscribeSnapshots,
      subscribe
   };
}
