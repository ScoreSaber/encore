import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import { translate } from '@/lib/messages';
import { createLatestGuard } from '@/lib/state/machine';
import {
   createDefaultLaunchOptions,
   unavailableLaunchPreview,
   type LaunchOptions,
   type LaunchPreview,
   type LaunchRecord,
   type LaunchRequestBody,
   type LaunchState
} from '@/modules/launch/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import { beatSaberPackageId, questInstallId } from '@/modules/quest/contract';
import type { QuestConnection, QuestDeviceService } from '@/modules/quest/main/quest-device-service';
import type { QuestMutationLock } from '@/modules/quest/main/quest-mutation-lock';
import { questModDataDir } from '@/modules/quest/main/quest-paths';
import type { TargetId } from '@/modules/targets/contract';

export function createQuestLaunchService(options: { devices: QuestDeviceService; operations: OperationRegistry; mutations: QuestMutationLock }) {
   const lastLaunches = new Map<TargetId, LaunchRecord>();
   const publishGuards = new Map<TargetId, ReturnType<typeof createLatestGuard>>();
   const listeners = new Set<(targetId: TargetId, state: LaunchState) => void>();
   let disposed = false;
   const isDisposed = () => disposed;
   const unsubscribeDevices = options.devices.subscribe((event) => {
      if (isDisposed() || listeners.size === 0) return;
      void publishState(event.type === 'target-updated' ? event.target.id : event.targetId);
   });

   async function getState(targetId: TargetId): Promise<LaunchState> {
      const connection = options.devices.getConnection(targetId);
      const running = Result.isOk(connection) ? await connection.value.client.packageRunning(connection.value.serial, beatSaberPackageId) : null;
      return {
         platform: 'quest',
         supported: Result.isOk(connection) && connection.value.gameVersion !== null,
         gameRunning: running !== null && Result.isOk(running) && running.value,
         steamFrame: false,
         lastLaunch: lastLaunches.get(targetId) ?? null
      };
   }

   function updateOptions(request: LaunchRequestBody) {
      return supportsOptions(request.options) ? Result.ok(createDefaultLaunchOptions()) : Result.err(createProblem('quest.launch.invalid-options'));
   }

   function preview(targetId: TargetId, request: LaunchRequestBody): LaunchPreview {
      const connection = options.devices.getConnection(targetId);
      if (Result.isError(connection)) return unavailableLaunchPreview(request, 'inspect-failed', connection.error.message);
      return plan(connection.value, request);
   }

   function plan(connection: QuestConnection, request: LaunchRequestBody): LaunchPreview {
      if (request.installId !== questInstallId || !connection.gameVersion) return unavailableLaunchPreview(request, 'not-found');
      if (!supportsOptions(request.options)) return unavailableLaunchPreview(request, 'invalid-options');
      return {
         status: 'ok',
         installId: questInstallId,
         name: 'Beat Saber',
         store: null,
         version: connection.gameVersion,
         executablePath: beatSaberPackageId,
         workingDirectory: questModDataDir,
         args: [],
         options: createDefaultLaunchOptions(),
         proton: null,
         startClient: null,
         warnings: []
      };
   }

   function start(targetId: TargetId, request: LaunchRequestBody) {
      return Result.gen(async function* () {
         const connection = yield* options.devices.getConnection(targetId);
         const planned = plan(connection, request);
         if (planned.status === 'unavailable') {
            return Result.err(createProblem(planned.issue === 'invalid-options' ? 'quest.launch.invalid-options' : 'quest.launch.not-found'));
         }
         return run(targetId, translate('quest.operations.launch'), async () => {
            const launched = await connection.client.startPackage(connection.serial, beatSaberPackageId);
            if (Result.isOk(launched))
               lastLaunches.set(targetId, { installId: questInstallId, launchedAt: new Date().toISOString(), options: planned.options });
            return launched;
         });
      });
   }

   function stop(targetId: TargetId) {
      return Result.gen(async function* () {
         const connection = yield* options.devices.getConnection(targetId);
         return run(targetId, translate('quest.operations.stop'), () => connection.client.forceStop(connection.serial, beatSaberPackageId));
      });
   }

   async function run(targetId: TargetId, title: string, action: () => Promise<Result<unknown, Problem>>) {
      const job = options.mutations.acquire(targetId);
      if (Result.isError(job)) return Result.err(job.error);
      try {
         const operation = options.operations.create({ kind: 'launch-preparation', title, targetId });
         const done = await action();
         if (Result.isError(done)) return Result.ok(options.operations.fail(operation.id, done.error) ?? operation);
         const completed = options.operations.complete(operation.id, { installId: questInstallId });
         await publishState(targetId);
         return Result.ok(completed ?? operation);
      } finally {
         job.value.release();
      }
   }

   async function publishState(targetId: TargetId) {
      if (isDisposed()) return;
      let guard = publishGuards.get(targetId);
      if (!guard) {
         guard = createLatestGuard();
         publishGuards.set(targetId, guard);
      }
      const token = guard.next();
      const state = await getState(targetId);
      if (isDisposed() || !guard.isCurrent(token)) return;
      for (const listener of listeners) listener(targetId, state);
   }

   function subscribe(listener: (targetId: TargetId, state: LaunchState) => void) {
      listeners.add(listener);
      return () => {
         listeners.delete(listener);
      };
   }

   function dispose() {
      disposed = true;
      unsubscribeDevices();
      listeners.clear();
      for (const guard of publishGuards.values()) guard.invalidate();
      publishGuards.clear();
   }

   return { getState, updateOptions, preview, start, stop, subscribe, dispose };
}

function supportsOptions(options: LaunchOptions) {
   return options.flags.length === 0 && options.args.length === 0 && Object.keys(options.environment).length === 0 && !options.runAsAdmin;
}
