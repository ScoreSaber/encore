import { Result } from 'better-result';

import { claimUniqueArchiveEntryName } from '@/lib/archive/path';
import { writeZipAtomic, type ZipSourceFile } from '@/lib/archive/zip-write';
import { isSafeFileName } from '@/lib/filesystem/path';
import type { LocalModelSummary, ModelProblem } from '@/modules/models/contract';
import { modelFolderName } from '@/modules/models/main/model-paths';
import { createModelProblem, type ModelResult } from '@/modules/models/main/model-problem';
import type { OperationProgress } from '@/modules/operations/contract';

import { stat } from 'node:fs/promises';

const maxExportBytes = 512 * 1024 * 1024;

export type ExportModelsRequest = {
   models: readonly LocalModelSummary[];
   destinationPath: string;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
};

export type ExportModelsSummary = {
   destinationPath: string;
   modelCount: number;
   bytes: number;
   files: number;
};

export async function exportModelsToZip(request: ExportModelsRequest): Promise<ModelResult<ExportModelsSummary>> {
   const files: ZipSourceFile[] = [];
   const usedNames = new Set<string>();
   const totalBytes = request.models.reduce((total, model) => total + model.sizeBytes, 0);
   let bytes = 0;
   let fileCount = 0;

   for (const model of request.models) {
      if (request.signal?.aborted) {
         return Result.err<ExportModelsSummary, ModelProblem>(createModelProblem('models.export.cancelled', 'the export was cancelled'));
      }
      if (!isSafeFileName(model.fileName)) continue;

      const stats = await Result.tryPromise({
         try: () => stat(model.path),
         catch: (cause): ModelProblem =>
            createModelProblem('models.file.unreadable', 'a selected model could not be read', { type: model.type, fileName: model.fileName, cause })
      });
      if (Result.isError(stats)) return Result.err<ExportModelsSummary, ModelProblem>(stats.error);

      bytes += stats.value.size;
      if (bytes > maxExportBytes) {
         return Result.err<ExportModelsSummary, ModelProblem>(
            createModelProblem('models.export.failed', 'the selection is too large to export as one archive', {
               type: model.type,
               fileName: model.fileName
            })
         );
      }

      fileCount += 1;
      files.push({
         archivePath: claimUniqueArchiveEntryName(`${modelFolderName(model.type)}/${model.fileName}`, usedNames),
         sourcePath: model.path
      });

      request.onProgress?.({
         phase: 'reading',
         label: model.name,
         current: bytes,
         total: totalBytes,
         unit: 'bytes'
      });
   }

   if (fileCount === 0) {
      return Result.err<ExportModelsSummary, ModelProblem>(createModelProblem('models.export.failed', 'the selected models held no readable files'));
   }

   request.onProgress?.({ phase: 'compressing', current: bytes, total: bytes, percent: 100, unit: 'bytes' });

   const written = await writeZipAtomic(request.destinationPath, files, request.signal);
   if (Result.isError(written)) {
      if (request.signal?.aborted) {
         return Result.err<ExportModelsSummary, ModelProblem>(createModelProblem('models.export.cancelled', 'the export was cancelled'));
      }

      return Result.err<ExportModelsSummary, ModelProblem>(
         createModelProblem('models.export.failed', 'the archive could not be written', { cause: written.error.detail })
      );
   }

   return Result.ok<ExportModelsSummary, ModelProblem>({
      destinationPath: request.destinationPath,
      modelCount: fileCount,
      bytes,
      files: fileCount
   });
}
