import { Result } from 'better-result';

import type { ContentIngestionService, IngestFileRequest, StagedFile } from '@/lib/content/content-ingestion';
import type { ContentLimits } from '@/lib/content/content-limits';
import type { ContentProblem, ContentSource } from '@/lib/content/contract';
import { createProblem, type Problem } from '@/lib/errors';
import { createUniquePath } from '@/lib/filesystem/path';
import type { ModelHash, ModelType } from '@/modules/models/contract';
import { computeModelHash } from '@/modules/models/main/model-hash';
import { modelExtension, modelFolderPath, modelTypeForFileName } from '@/modules/models/main/model-paths';
import type { OperationProgress } from '@/modules/operations/contract';

import { join } from 'node:path';

export const modelContentLimits: Partial<ContentLimits> = {
   maxDownloadBytes: 256 * 1024 * 1024
};

export type ModelFileSource = {
   source: ContentSource;
   type: ModelType;
   fileName: string;
   expectedHash?: ModelHash;
};

export type InstallModelFilesInput = {
   ingestion: ContentIngestionService;
   installPath: string;
   sources: ModelFileSource[];
   allowedHosts?: readonly string[];
   installed: Set<string>;
   signal: AbortSignal;
   onProgress: (index: number, progress: OperationProgress) => void;
};

export function modelKey(type: ModelType, hash: ModelHash) {
   return `${type}:${hash}`;
}

export async function installModelFiles(input: InstallModelFilesInput) {
   let bytes = 0;
   let files = 0;
   let modelCount = 0;
   let lastProblem: Problem | null = null;

   for (const [index, entry] of input.sources.entries()) {
      if (input.signal.aborted) break;

      const installed = await installModelFile({ ...input, ...entry, index });
      if (Result.isError(installed)) {
         lastProblem = installed.error;
         continue;
      }

      bytes += installed.value.bytes;
      files += installed.value.files;
      modelCount += 1;
   }

   return { bytes, files, modelCount, lastProblem };
}

async function installModelFile(
   input: InstallModelFilesInput & ModelFileSource & { index: number }
): Promise<Result<{ bytes: number; files: number }, Problem>> {
   const folderPath = modelFolderPath(input.installPath, input.type);
   const request: IngestFileRequest = {
      source: input.source,
      fileName: input.fileName,
      signal: input.signal,
      validate: ({ fileName }) =>
         modelTypeForFileName(fileName) === input.type
            ? Result.ok<void, ContentProblem>(undefined)
            : Result.err<void, ContentProblem>(createProblem('content.ingest.model-type', { type: input.type, detail: modelExtension(input.type) })),
      onProgress: (progress) => input.onProgress(input.index, progress)
   };
   if (input.allowedHosts) request.urlPolicy = { allowedHosts: input.allowedHosts };
   const staged = await input.ingestion.ingestFile(request);
   if (Result.isError(staged)) return Result.err(staged.error);

   const placed = await placeStagedModel(input, staged.value, folderPath);
   if (Result.isError(placed)) await staged.value.dispose();
   return placed;
}

function placeStagedModel(input: InstallModelFilesInput & ModelFileSource & { index: number }, staged: StagedFile, folderPath: string) {
   const fields = { type: input.type, fileName: input.fileName };

   return Result.gen(async function* () {
      const hash = yield* Result.await(computeModelHash({ path: staged.path, ...fields }));
      if (input.expectedHash && input.expectedHash !== hash) return Result.err(createProblem('models.hash.mismatch', fields));
      if (input.installed.has(modelKey(input.type, hash))) return Result.err(createProblem('models.already-installed', fields));

      const destinationPath = yield* Result.await(
         createUniquePath(join(folderPath, staged.fileName), modelExtension(input.type)).then((path) =>
            path.mapError((cause) => createProblem('models.write.failed', { ...fields, cause }))
         )
      );
      const committed = yield* Result.await(
         staged.commit({
            destinationPath,
            destinationRoot: folderPath,
            signal: input.signal,
            onProgress: (progress) => input.onProgress(input.index, progress)
         })
      );

      input.installed.add(modelKey(input.type, hash));
      return Result.ok({ bytes: committed.bytes, files: committed.files });
   });
}
