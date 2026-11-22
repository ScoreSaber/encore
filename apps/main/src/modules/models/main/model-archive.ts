import { Result } from 'better-result';

import { claimUniqueArchiveEntryName } from '@/lib/archive/path';
import { exportZip } from '@/lib/archive/zip-write';
import type { ContentProblem } from '@/lib/content/contract';
import { isSafeFileName } from '@/lib/filesystem/path';
import type { LocalModelSummary } from '@/modules/models/contract';
import { modelFolderName } from '@/modules/models/main/model-paths';
import type { OperationProgress } from '@/modules/operations/contract';

const maxExportBytes = 512 * 1024 * 1024;

type ExportModelsRequest = {
   models: readonly LocalModelSummary[];
   destinationPath: string;
   signal: AbortSignal;
   onProgress: (progress: OperationProgress) => void;
};

type ExportModelsSummary = {
   modelCount: number;
   bytes: number;
   files: number;
};

export async function exportModelsToZip(request: ExportModelsRequest): Promise<Result<ExportModelsSummary, ContentProblem>> {
   const usedNames = new Set<string>();
   const exported = await exportZip({
      items: request.models,
      destinationPath: request.destinationPath,
      maxBytes: maxExportBytes,
      signal: request.signal,
      onProgress: request.onProgress,
      labelOf: (model) => model.name,
      filesOf: async (model) =>
         isSafeFileName(model.fileName)
            ? [{ archivePath: claimUniqueArchiveEntryName(`${modelFolderName(model.type)}/${model.fileName}`, usedNames), sourcePath: model.path }]
            : []
   });
   return exported.map((summary) => ({ modelCount: summary.files, ...summary }));
}
