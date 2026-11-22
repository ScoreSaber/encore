import { Result } from 'better-result';
import { z } from 'zod';

import { createProblem } from '@/lib/errors';
import { removeQuietly } from '@/lib/filesystem/path';
import { questModSourceId, questModSourceName, type ExternalMod, type ModSummary } from '@/modules/mods/contract';
import { modIndexKey, type ModIndex } from '@/modules/mods/main/mod-index';
import type { InstalledMod, ModScan } from '@/modules/mods/main/mod-scan';
import { beatSaberPackageId } from '@/modules/quest/contract';
import { openQmod, parseQmodManifest, type QmodManifest } from '@/modules/quest/main/qmod';
import type { QuestConnection } from '@/modules/quest/main/quest-device-service';
import {
   questEarlyModsDir,
   questLateModsDir,
   questLibsDir,
   questPackagesDir,
   questPackagePath,
   questRecordsPath,
   sanitizeQuestFileName
} from '@/modules/quest/main/quest-paths';

import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const maxMbfPackages = 256;

const questRecordSchema = z.object({
   id: z.string(),
   name: z.string(),
   version: z.string(),
   modId: z.string().nullable().default(null),
   requiredDependencies: z.array(z.string()).optional(),
   files: z.array(z.string()),
   packagePath: z.string()
});

export type QuestRecord = z.infer<typeof questRecordSchema>;

export type QuestScan = ModScan & { records: QuestRecord[]; missing: Set<string>; libraries: ModSummary[] };

export function qmodFileTargets(manifest: QmodManifest) {
   const into = (directory: string, names: string[]) =>
      names.map((name) => ({ name, path: `${directory}/${sanitizeQuestFileName(basename(name))}` }));

   return [
      ...into(questEarlyModsDir, manifest.modFiles),
      ...into(questLateModsDir, manifest.lateModFiles),
      ...into(questLibsDir, manifest.libraryFiles),
      ...manifest.fileCopies.map((copy) => ({ name: copy.name, path: copy.destination }))
   ];
}

export function installedRecords(scan: QuestScan) {
   return scan.records.filter((record) => !scan.missing.has(record.id));
}

export function requiredQuestDependencies(manifest: QmodManifest) {
   return manifest.dependencies.filter((dependency) => dependency.required).map((dependency) => dependency.id);
}

export async function readLegacyQuestDependencies({ client, serial }: QuestConnection, record: QuestRecord, staging: string, maxBytes: number) {
   if (record.packagePath !== questPackagePath(record.id)) return undefined;
   const stats = await client.directoryStats(serial, record.packagePath);
   if (Result.isError(stats) || stats.value.files !== 1 || stats.value.bytes > maxBytes) return undefined;

   const path = join(staging, 'installed.qmod');
   const pulled = await client.pull(serial, record.packagePath, path);
   if (Result.isError(pulled)) return undefined;

   const opened = await openQmod(path);
   if (Result.isOk(opened)) opened.value.close();
   await removeQuietly(path);
   if (Result.isError(opened)) return undefined;
   const { manifest } = opened.value;
   if (manifest.id !== record.id || manifest.version !== record.version) return undefined;
   return requiredQuestDependencies(manifest);
}

export function readQuestMods(connection: QuestConnection, gameVersion: string) {
   return Result.gen(async function* () {
      const records = yield* Result.await(readRecords(connection));
      for (const record of await readMbfRecords(connection, gameVersion)) {
         if (!records.some((existing) => existing.id === record.id)) records.push(record);
      }

      const missing = new Set<string>();
      for (const record of records) {
         const exists = await Promise.all([record.packagePath, ...record.files].map((path) => connection.client.fileExists(connection.serial, path)));
         if (!exists.every((result) => Result.isOk(result) && result.value)) missing.add(record.id);
      }

      const external: ExternalMod[] = [];
      const knownPackages = new Set(records.map((record) => basename(record.packagePath)));
      const listed = await connection.client.listFiles(connection.serial, questPackagesDir);
      if (Result.isOk(listed)) {
         for (const name of listed.value) {
            if (!name.toLowerCase().endsWith('.qmod') || knownPackages.has(name)) continue;
            external.push({ id: `qmod:${name}`, name, path: `${questPackagesDir}/${name}`, sizeBytes: 0, details: null });
         }
      }

      return Result.ok({ records, missing, external });
   });
}

export function describeScan(
   index: ModIndex,
   modloaderInstalled: boolean,
   records: QuestRecord[],
   missing: Set<string>,
   external: ExternalMod[]
): QuestScan {
   const installed = new Map<string, InstalledMod>();
   const libraries: ModSummary[] = [];
   const visibleExternal = [...external];
   for (const record of records.filter((entry) => !missing.has(entry.id))) {
      const entry =
         index.entries.find((candidate) => candidate.modId === record.modId) ?? index.entries.find((candidate) => candidate.packageId === record.id);
      if (entry) {
         installed.set(entry.modId, { modId: entry.modId, version: record.version });
         continue;
      }

      const listedKey = modIndexKey(questModSourceId, record.id);
      const modId = record.modId ?? listedKey;
      if (index.entries.some((candidate) => candidate.dependencies.includes(listedKey))) {
         installed.set(modId, { modId, version: record.version });
         libraries.push(toLibrarySummary(modId, record));
      } else {
         visibleExternal.push({
            id: `record:${record.id}`,
            name: record.name,
            path: record.packagePath,
            sizeBytes: 0,
            details: { name: record.name, version: record.version, author: null, gameVersion: null, description: null, links: [] }
         });
      }
   }

   return { installed, external: visibleExternal, bsipaInstalled: modloaderInstalled, records, missing, libraries };
}

function toLibrarySummary(modId: string, record: QuestRecord): ModSummary {
   return {
      modId,
      sourceId: questModSourceId,
      sourceName: questModSourceName,
      sourceKind: 'official',
      name: record.name,
      summary: '',
      description: '',
      iconUrl: null,
      links: [],
      category: 'library',
      author: '',
      state: 'installed',
      latestVersion: record.version,
      installedVersion: record.version,
      sizeBytes: null,
      isBsipa: false,
      isRequired: true,
      dependencyIds: [],
      claimedIdentity: null
   };
}

export function recordModId(record: QuestRecord, scan: QuestScan) {
   return (
      [...scan.installed.values()].find((entry) => entry.modId === record.modId || entry.modId.endsWith(`:${record.id}`))?.modId ??
      record.modId ??
      modIndexKey(questModSourceId, record.id)
   );
}

export function saveRecords(connection: QuestConnection, records: QuestRecord[], staging: string) {
   const localPath = join(staging, basename(questRecordsPath));

   return Result.gen(async function* () {
      yield* Result.await(
         Result.tryPromise({
            try: () => writeFile(localPath, JSON.stringify(records, null, 2), 'utf8'),
            catch: (cause) => createProblem('quest.install.records-failed', { cause })
         })
      );
      return connection.client.push(connection.serial, localPath, questRecordsPath);
   });
}

function readRecords({ client, serial }: QuestConnection) {
   return Result.gen(async function* () {
      if (!(yield* Result.await(client.fileExists(serial, questRecordsPath)))) return Result.ok<QuestRecord[]>([]);
      const raw = yield* Result.await(client.readTextFile(serial, questRecordsPath));
      const parsed = Result.try(() => questRecordSchema.array().parse(JSON.parse(raw)));
      if (Result.isOk(parsed)) return parsed;
      yield* Result.await(client.movePath(serial, questRecordsPath, `${questRecordsPath}.corrupt-${Date.now()}`));
      return Result.ok<QuestRecord[]>([]);
   });
}

async function readMbfRecords({ client, serial }: QuestConnection, gameVersion: string) {
   if (!/^\d[\w.-]*$/.test(gameVersion)) return [];
   const versionRoot = `${questPackagesDir}/${gameVersion}`;
   const listing = await client.listFiles(serial, versionRoot);
   if (Result.isError(listing)) return [];

   const records: QuestRecord[] = [];
   for (const name of listing.value.slice(0, maxMbfPackages)) {
      if (!/^[\w.-]+$/.test(name) || name === '.' || name === '..') continue;
      const packagePath = `${versionRoot}/${name}`;
      const raw = await client.readTextFile(serial, `${packagePath}/mod.json`);
      if (Result.isError(raw)) continue;
      const parsed = parseQmodManifest(raw.value);
      if (Result.isError(parsed)) continue;
      const manifest = parsed.value;
      if (manifest.packageId !== beatSaberPackageId || manifest.modloader.toLowerCase() !== 'scotland2') continue;
      const files = qmodFileTargets(manifest).map((target) => target.path);
      const exists = await Promise.all(files.map((file) => client.fileExists(serial, file)));
      if (exists.some((result) => Result.isError(result) || !result.value)) continue;
      records.push({
         id: manifest.id,
         name: manifest.name,
         version: manifest.version,
         modId: null,
         requiredDependencies: requiredQuestDependencies(manifest),
         files,
         packagePath
      });
   }
   return records;
}
