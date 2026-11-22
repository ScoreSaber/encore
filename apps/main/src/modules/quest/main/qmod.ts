import { Result } from 'better-result';
import { z } from 'zod';

import { openZipArchive, zipCompressionDeflate, zipCompressionStored, type ZipArchive, type ZipEntryRecord } from '@/lib/archive/zip-read';
import { createProblem, type Problem } from '@/lib/errors';
import { beatSaberPackageId } from '@/modules/quest/contract';

import { createWriteStream } from 'node:fs';
import { text } from 'node:stream/consumers';
import { pipeline } from 'node:stream/promises';

const qmodManifestName = 'mod.json';
const maxManifestBytes = 1024 * 1024;
const maxQmodEntries = 2_000;

const qmodManifestSchema = z.object({
   id: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[\w.-]+$/),
   name: z.string().min(1),
   version: z.string().min(1),
   author: z.string().default(''),
   description: z.string().default(''),
   packageId: z.string().default(beatSaberPackageId),
   packageVersion: z.string().nullish(),
   modloader: z.string().default('QuestLoader'),
   coverImage: z.string().nullish(),
   isLibrary: z.boolean().default(false),
   modFiles: z.array(z.string()).default([]),
   lateModFiles: z.array(z.string()).default([]),
   libraryFiles: z.array(z.string()).default([]),
   fileCopies: z.array(z.object({ name: z.string(), destination: z.string() })).default([]),
   copyExtensions: z.array(z.object({ extension: z.string(), destination: z.string() })).default([]),
   dependencies: z
      .array(
         z.object({
            id: z
               .string()
               .min(1)
               .max(120)
               .regex(/^[\w.-]+$/),
            version: z.string().default('*'),
            required: z.boolean().default(true),
            downloadIfMissing: z.string().nullish()
         })
      )
      .default([])
});

export type QmodManifest = z.infer<typeof qmodManifestSchema>;

export type OpenedQmod = {
   manifest: QmodManifest;
   extract: (entryName: string, targetPath: string) => Promise<Result<void, Problem>>;
   close: () => void;
};

export function parseQmodManifest(raw: string): Result<QmodManifest, Problem> {
   return Result.try({
      try: () => qmodManifestSchema.safeParse(JSON.parse(raw)),
      catch: (cause) => createProblem('quest.qmod.invalid-json', { cause })
   }).andThen((manifest) =>
      manifest.success
         ? Result.ok(manifest.data)
         : Result.err(createProblem('quest.qmod.invalid-manifest', { detail: manifest.error.issues.map((issue) => issue.path.join('.')).join(', ') }))
   );
}

export async function openQmod(archivePath: string): Promise<Result<OpenedQmod, Problem>> {
   const archive = await openZipArchive(archivePath, { maxEntries: maxQmodEntries });
   if (Result.isError(archive)) return Result.err(createProblem('quest.qmod.unreadable', { detail: archive.error.message }));

   const zip = archive.value;
   if (
      zip.records.some((record) => record.uncompressedBytes > 128 * 1024 * 1024) ||
      zip.records.reduce((total, record) => total + record.uncompressedBytes, 0) > 256 * 1024 * 1024
   ) {
      zip.close();
      return Result.err(createProblem('quest.qmod.too-large'));
   }

   const findRecord = (entryName: string) =>
      zip.records.find(
         (record) =>
            record.name === entryName &&
            !record.encrypted &&
            (record.compressionMethod === zipCompressionStored || record.compressionMethod === zipCompressionDeflate)
      );

   const manifestRecord = findRecord(qmodManifestName);
   if (!manifestRecord || manifestRecord.uncompressedBytes > maxManifestBytes) {
      zip.close();
      return Result.err(createProblem('quest.qmod.missing-manifest'));
   }

   const raw = await readRecordText(zip.openEntryStream, manifestRecord);
   if (Result.isError(raw)) {
      zip.close();
      return Result.err(raw.error);
   }

   const manifest = parseQmodManifest(raw.value);
   if (Result.isError(manifest)) {
      zip.close();
      return Result.err(manifest.error);
   }
   const referencedFiles = [
      ...manifest.value.modFiles,
      ...manifest.value.lateModFiles,
      ...manifest.value.libraryFiles,
      ...manifest.value.fileCopies.map((copy) => copy.name)
   ];
   const missing = referencedFiles.find((name) => !findRecord(name));
   if (missing) {
      zip.close();
      return Result.err(createProblem('quest.qmod.missing-file', { detail: missing }));
   }

   async function extract(entryName: string, targetPath: string): Promise<Result<void, Problem>> {
      const record = findRecord(entryName);
      if (!record) return Result.err(createProblem('quest.qmod.missing-file', { detail: entryName }));

      const stream = await zip.openEntryStream(record);
      if (Result.isError(stream)) return Result.err(createProblem('quest.qmod.entry-unreadable', { entry: entryName, detail: stream.error.message }));

      return Result.tryPromise({
         try: () => pipeline(stream.value, createWriteStream(targetPath)),
         catch: (cause) => createProblem('quest.qmod.entry-unreadable', { entry: entryName, cause })
      });
   }

   return Result.ok({
      manifest: manifest.value,
      extract,
      close: () => zip.close()
   });
}

async function readRecordText(openEntryStream: ZipArchive['openEntryStream'], record: ZipEntryRecord): Promise<Result<string, Problem>> {
   const stream = await openEntryStream(record);
   if (Result.isError(stream)) return Result.err(createProblem('quest.qmod.manifest-unreadable', { detail: stream.error.message }));

   return Result.tryPromise({
      try: () => text(stream.value),
      catch: (cause) => createProblem('quest.qmod.manifest-unreadable', { cause })
   });
}
