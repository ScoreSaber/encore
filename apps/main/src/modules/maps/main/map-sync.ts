import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import { translate } from '@/lib/messages';
import { mapsApi, mapSyncApi } from '@/modules/maps/api';
import type { LocalMapSummary, MapSyncPreview, MapSyncRequest, MapSyncSide, MapSyncStarted } from '@/modules/maps/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import { localTargetId } from '@/modules/targets/contract';
import type { TargetRegistry } from '@/modules/targets/main/target-registry';

import { randomUUID } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

type Transfer = { map: LocalMapSummary; from: MapSyncSide; to: MapSyncSide };

export function createMapSyncService(options: {
   registry: Pick<TargetRegistry, 'callTarget' | 'downloadTarget' | 'hostOf' | 'uploadTarget'>;
   operations: OperationRegistry;
   stagingRoot: string;
}) {
   const { registry } = options;

   async function listMaps(side: MapSyncSide) {
      const listed = await registry.callTarget(mapsApi, 'list', side.targetId, { installId: side.installId });
      if (listed.status === 'unavailable') return Result.err(listed.error);
      if (listed.status !== 'ok') return Result.err(createProblem('maps.sync.unsupported'));
      if (listed.value.status !== 'ready') return Result.err(createProblem('maps.sync.loading'));
      const usable = listed.value.maps.filter((map) => map.hash && !map.problem);
      return Result.ok([...new Map(usable.map((map) => [map.hash, map])).values()]);
   }

   function plan(request: MapSyncRequest) {
      return Result.gen(async function* () {
         const [listedFirst, listedSecond] = await Promise.all([listMaps(request.first), listMaps(request.second)]);
         const first = yield* listedFirst;
         const second = yield* listedSecond;
         const inFirst = new Set(first.map((map) => map.hash));
         const inSecond = new Set(second.map((map) => map.hash));
         return Result.ok<Transfer[]>([
            ...first.filter((map) => !inSecond.has(map.hash)).map((map) => ({ map, from: request.first, to: request.second })),
            ...second.filter((map) => !inFirst.has(map.hash)).map((map) => ({ map, from: request.second, to: request.first }))
         ]);
      });
   }

   function delegation(request: MapSyncRequest) {
      const first = registry.hostOf(request.first.targetId);
      const second = registry.hostOf(request.second.targetId);
      if (!first || !second || first.remoteId !== second.remoteId) return null;
      return {
         remoteId: first.remoteId,
         request: { first: { ...request.first, targetId: first.hostedTargetId }, second: { ...request.second, targetId: second.hostedTargetId } }
      };
   }

   async function preview(request: MapSyncRequest): Promise<MapSyncPreview> {
      const delegated = delegation(request);
      if (delegated) {
         const previewed = await registry.callTarget(mapSyncApi, 'preview', delegated.remoteId, delegated.request);
         if (previewed.status === 'ok') return { ...previewed.value, runsOn: delegated.remoteId };
      }

      const planned = await plan(request);
      if (Result.isError(planned)) return { toFirst: 0, toSecond: 0, problem: planned.error.message, runsOn: null };
      return {
         problem: null,
         runsOn: null,
         toSecond: planned.value.filter((transfer) => transfer.to === request.second).length,
         toFirst: planned.value.filter((transfer) => transfer.to === request.first).length
      };
   }

   async function start(request: MapSyncRequest): Promise<Result<MapSyncStarted, Problem>> {
      const delegated = delegation(request);
      if (delegated) {
         const started = await registry.callTarget(mapSyncApi, 'start', delegated.remoteId, delegated.request);
         if (started.status === 'ok') {
            return started.value.ok
               ? Result.ok({ targetId: delegated.remoteId, operation: started.value.value.operation })
               : Result.err(started.value.error);
         }
      }

      return (await plan(request)).map((transfers) => ({ targetId: localTargetId, operation: startTransfers(transfers) }));
   }

   function startTransfers(transfers: Transfer[]) {
      const totalBytes = transfers.reduce((total, transfer) => total + transfer.map.sizeBytes, 0);
      return options.operations.start(
         {
            kind: 'copy',
            title: translate('maps.sync.title'),
            progress: { phase: 'preparing', current: 0, total: totalBytes, percent: 0, unit: 'bytes' },
            metadata: { mapCount: transfers.length }
         },
         async (operationId, signal) => {
            const ran = await Result.tryPromise(() => run(operationId, transfers, totalBytes, signal));
            if (Result.isError(ran)) options.operations.fail(operationId, createProblem('maps.sync.failed', { cause: ran.error }));
         }
      );
   }

   async function run(operationId: string, transfers: Transfer[], totalBytes: number, signal: AbortSignal) {
      const staging = join(options.stagingRoot, randomUUID());
      await mkdir(staging, { recursive: true });
      let copied = 0;
      let doneBytes = 0;
      let lastProblem: Problem | null = null;
      const report = (message: string, inFlight: number) =>
         options.operations.update(operationId, {
            message,
            progress: {
               phase: 'copying',
               current: doneBytes + inFlight,
               total: totalBytes,
               percent: totalBytes > 0 ? Math.min(100, Math.round(((doneBytes + inFlight) / totalBytes) * 100)) : 0,
               unit: 'bytes'
            }
         });

      try {
         for (const [index, transfer] of transfers.entries()) {
            if (signal.aborted) break;
            const { map } = transfer;
            const archive = join(staging, `${index}.zip`);
            report(map.title, 0);
            let watchingArchive = true;
            const watching = setInterval(() => {
               void Result.tryPromise(() => stat(archive)).then((info) => {
                  if (watchingArchive && !signal.aborted && Result.isOk(info)) {
                     report(map.title, Math.min(info.value.size, map.sizeBytes) / 2);
                  }
               });
            }, 500);
            const stopWatching = () => {
               watchingArchive = false;
               clearInterval(watching);
            };
            const copiedMap = await copy(transfer, archive, signal, () => {
               stopWatching();
               report(map.title, map.sizeBytes / 2);
            }).finally(stopWatching);
            await rm(archive, { force: true });
            if (Result.isOk(copiedMap)) copied += 1;
            else if (!signal.aborted) lastProblem = copiedMap.error;
            doneBytes += map.sizeBytes;
            report(map.title, 0);
         }
      } finally {
         await rm(staging, { recursive: true, force: true });
      }

      if (signal.aborted) return;
      if (transfers.length > 0 && copied === 0 && lastProblem) return options.operations.fail(operationId, lastProblem);
      options.operations.complete(operationId, { mapCount: copied, bytes: doneBytes, files: copied, failed: transfers.length - copied });
   }

   async function copy({ map, from, to }: Transfer, archive: string, signal: AbortSignal, onRead: () => void): Promise<Result<number, Problem>> {
      const downloaded = await registry.downloadTarget(
         mapsApi,
         'exportArchive',
         from.targetId,
         { installId: from.installId, mapId: map.id },
         archive,
         signal
      );
      if (downloaded.status === 'unavailable') return Result.err(createProblem('maps.sync.read-failed', { cause: downloaded.error.message }));
      if (downloaded.status !== 'ok') return Result.err(createProblem('maps.sync.unsupported'));
      if (signal.aborted) return Result.err(createProblem('maps.sync.cancelled'));
      onRead();

      const uploaded = await registry.uploadTarget(
         mapsApi,
         'importArchive',
         to.targetId,
         { installId: to.installId },
         { path: archive, sizeBytes: downloaded.value.sizeBytes },
         signal
      );
      if (uploaded.status === 'unavailable') return Result.err(createProblem('maps.sync.write-failed', { cause: uploaded.error.message }));
      if (uploaded.status !== 'ok') return Result.err(createProblem('maps.sync.unsupported'));
      return Result.ok(downloaded.value.sizeBytes);
   }

   return { preview, start };
}
