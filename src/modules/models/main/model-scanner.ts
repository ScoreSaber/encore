import { Result } from 'better-result';

import { scanInBatches } from '@/lib/filesystem/scan';
import { modelTypes, type LocalModelSummary, type ModelFolderSummary, type ModelProblem, type ModelType } from '@/modules/models/contract';
import { computeModelHash } from '@/modules/models/main/model-hash';
import { modelDisplayName, modelExtension, modelFolderPath } from '@/modules/models/main/model-paths';
import { createModelProblem } from '@/modules/models/main/model-problem';

import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

export type ModelScanCacheEntry = {
   fingerprint: string;
   model: LocalModelSummary;
};

export type ModelScanCache = Map<string, ModelScanCacheEntry>;

export type ModelScanOptions = {
   installPath: string;
   cache?: ModelScanCache;
   signal?: AbortSignal;
   onProgress?: (progress: { scanned: number; total: number }) => void;
};

export type ModelScanResult = {
   status: 'missing' | 'ready';
   folders: ModelFolderSummary[];
   models: LocalModelSummary[];
   problems: ModelProblem[];
};

type ScanEntry = {
   type: ModelType;
   folderPath: string;
   fileName: string;
};

export async function scanModelFolders(options: ModelScanOptions): Promise<ModelScanResult> {
   const folders: ModelFolderSummary[] = [];
   const problems: ModelProblem[] = [];
   const entries: ScanEntry[] = [];

   const listings = await Promise.all(
      modelTypes.map(async (type) => {
         const folderPath = modelFolderPath(options.installPath, type);
         return { type, folderPath, listed: await listModelFiles(folderPath, type) };
      })
   );

   for (const { type, folderPath, listed } of listings) {
      folders.push({ type, path: folderPath, exists: listed.exists });
      if (listed.problem) problems.push(listed.problem);

      for (const fileName of listed.fileNames) {
         entries.push({ type, folderPath, fileName });
      }
   }

   const models = await scanInBatches(entries, options, (entry) => readModel(entry, options.cache));

   markDuplicates(models);
   models.sort((first, second) => first.type.localeCompare(second.type) || first.name.localeCompare(second.name));

   return {
      status: folders.some((folder) => folder.exists) ? 'ready' : 'missing',
      folders,
      models,
      problems
   };
}

async function listModelFiles(folderPath: string, type: ModelType) {
   const entries = await Result.tryPromise({
      try: () => readdir(folderPath, { withFileTypes: true }),
      catch: (cause) => createModelProblem('models.root.unreadable', 'this model folder could not be read', { type, cause })
   });

   if (Result.isError(entries)) {
      const missing = entries.error.detail === 'ENOENT';
      return { exists: false, fileNames: [], problem: missing ? null : entries.error };
   }

   const extension = modelExtension(type);
   const fileNames = entries.value.filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === extension).map((entry) => entry.name);

   return { exists: true, fileNames, problem: null };
}

async function readModel(entry: ScanEntry, cache?: ModelScanCache): Promise<LocalModelSummary> {
   const id = modelId(entry.type, entry.fileName);
   const path = join(entry.folderPath, entry.fileName);
   const stats = await Result.tryPromise({
      try: () => stat(path),
      catch: (cause) =>
         createModelProblem('models.file.unreadable', 'this model file could not be read', { type: entry.type, fileName: entry.fileName, cause })
   });

   if (Result.isError(stats)) return emptyModel(entry, id, path, stats.error);

   const sizeBytes = stats.value.size;
   const updatedAt = new Date(stats.value.mtimeMs).toISOString();
   const fingerprint = `${sizeBytes}:${updatedAt}`;
   const cached = cache?.get(id);
   if (cached?.fingerprint === fingerprint) {
      cached.model.isDuplicate = false;
      return cached.model;
   }

   const hash = await computeModelHash({ path, fileName: entry.fileName, type: entry.type });
   const model: LocalModelSummary = {
      id,
      type: entry.type,
      fileName: entry.fileName,
      path,
      name: modelDisplayName(entry.fileName),
      author: null,
      hash: Result.isOk(hash) ? hash.value : null,
      source: 'local',
      thumbnailUrl: null,
      sizeBytes,
      updatedAt,
      isDuplicate: false,
      ...(Result.isError(hash) ? { problem: hash.error } : {})
   };

   cache?.set(id, { fingerprint, model });

   return model;
}

function emptyModel(entry: ScanEntry, id: string, path: string, problem: ModelProblem): LocalModelSummary {
   return {
      id,
      type: entry.type,
      fileName: entry.fileName,
      path,
      name: modelDisplayName(entry.fileName),
      author: null,
      hash: null,
      source: 'local',
      thumbnailUrl: null,
      sizeBytes: 0,
      updatedAt: new Date(0).toISOString(),
      isDuplicate: false,
      problem
   };
}

export function modelId(type: ModelType, fileName: string) {
   return `${type}:${fileName}`;
}

function markDuplicates(models: LocalModelSummary[]) {
   const counts = new Map<string, number>();
   for (const model of models) {
      if (model.hash) counts.set(model.hash, (counts.get(model.hash) ?? 0) + 1);
   }

   for (const model of models) {
      model.isDuplicate = model.hash !== null && (counts.get(model.hash) ?? 0) > 1;
   }
}
