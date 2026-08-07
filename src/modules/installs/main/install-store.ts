import { Result } from 'better-result';
import { z } from 'zod';

import { readJsonFileOrDefault, writeJsonFileAtomic } from '@/lib/filesystem/json';
import { isSamePath, resolveFilesystemPath, type FilesystemProblem } from '@/lib/filesystem/path';
import { installSourceSchema, type InstallId, type InstallSource } from '@/modules/installs/contract';
import { customInstallName } from '@/modules/installs/main/naming';
import { storeKindSchema, type StoreInstallCandidate, type StoreKind } from '@/modules/stores/contract';

import { createHash, randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';

export const installStoreFileVersion = 1;
export const installStoreFileName = 'installs.json';

export const installRecordSchema = z.object({
   id: z.string().min(1),
   targetId: z.string(),
   source: installSourceSchema,
   name: z.string().min(1).nullable(),
   pinned: z.boolean().default(false),
   color: z.string().nullable(),
   store: storeKindSchema.nullable(),
   path: z.string(),
   key: z.string().optional(),
   aliases: z.array(z.string()),
   libraryPath: z.string().optional(),
   appId: z.string().optional(),
   manifestPath: z.string().optional(),
   executablePath: z.string().optional(),
   createdAt: z.string(),
   updatedAt: z.string()
});

export const installStoreFileSchema = z.object({
   schemaVersion: z.literal(installStoreFileVersion),
   installs: z.array(installRecordSchema)
});

export type InstallRecord = z.infer<typeof installRecordSchema>;

export type InstallRegistration = {
   targetId: string;
   source: InstallSource;
   path: string;
   color?: string | null;
   store?: StoreKind | null;
};

export function storeInstallKey(candidate: StoreInstallCandidate) {
   const app = candidate.appId ?? basename(candidate.path);
   return `${candidate.targetId}|${candidate.store}|${app}|${resolveFilesystemPath(candidate.libraryPath)}`;
}

export function createInstallId(key: string) {
   return `install_${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
}

export function createInstallStore(options: { dataPath: string }) {
   const filePath = join(options.dataPath, installStoreFileName);
   let records: InstallRecord[] | null = null;

   async function load() {
      if (records) return records;

      const read = await readJsonFileOrDefault(filePath, installStoreFileSchema, {
         defaultValue: { schemaVersion: installStoreFileVersion, installs: [] }
      });

      records = read.installs;
      return records;
   }

   async function find(installId: InstallId) {
      return (await load()).find((record) => record.id === installId) ?? null;
   }

   async function findByPath(path: string) {
      const resolvedPath = resolveFilesystemPath(path);
      return (await load()).find((record) => isSamePath(record.path, resolvedPath)) ?? null;
   }

   async function resolveStoreCandidates(candidates: StoreInstallCandidate[]) {
      const current = await load();
      const now = new Date().toISOString();
      const detected = new Set<string>();
      const next: InstallRecord[] = [];
      const currentOrder = new Map(current.map((record, index) => [record.id, index]));
      let changed = false;

      for (const record of current) {
         if (record.source !== 'store') next.push(record);
      }

      for (const candidate of candidates) {
         const key = storeInstallKey(candidate);
         const id = createInstallId(key);
         if (detected.has(id)) continue;
         detected.add(id);

         const path = resolveFilesystemPath(candidate.path);
         const libraryPath = resolveFilesystemPath(candidate.libraryPath);
         const existing = current.find((record) => record.source === 'store' && matchesStoreRecord(record, id, key, candidate));
         const unchanged = existing?.key === key && existing.path === path && existing.libraryPath === libraryPath;
         const aliases =
            existing && existing.key && existing.key !== key ? [...new Set([...existing.aliases, existing.key])] : (existing?.aliases ?? []);

         next.push({
            id: existing?.id ?? id,
            targetId: candidate.targetId,
            source: 'store',
            name: existing?.name ?? customInstallName(basename(path)),
            pinned: existing?.pinned ?? false,
            color: existing?.color ?? null,
            store: candidate.store,
            path,
            key,
            aliases,
            libraryPath,
            ...(candidate.appId ? { appId: candidate.appId } : {}),
            ...(candidate.manifestPath ? { manifestPath: candidate.manifestPath } : {}),
            ...(candidate.executablePath ? { executablePath: candidate.executablePath } : {}),
            createdAt: existing?.createdAt ?? now,
            updatedAt: existing && unchanged ? existing.updatedAt : now
         });

         changed ||= !unchanged;
      }

      next.sort((left, right) => (currentOrder.get(left.id) ?? current.length) - (currentOrder.get(right.id) ?? current.length));

      changed ||= current.some((record) => record.source === 'store' && !next.some((candidate) => candidate.id === record.id));

      return changed ? persist(next) : Result.ok<InstallRecord[], FilesystemProblem>(next);
   }

   async function register(registration: InstallRegistration) {
      const path = resolveFilesystemPath(registration.path);
      const existing = await findByPath(path);
      if (existing) return Result.ok<InstallRecord, FilesystemProblem>(existing);

      const now = new Date().toISOString();
      const record: InstallRecord = {
         id: randomUUID(),
         targetId: registration.targetId,
         source: registration.source,
         name: customInstallName(basename(path)),
         pinned: false,
         color: registration.color ?? null,
         store: registration.store ?? null,
         path,
         aliases: [],
         createdAt: now,
         updatedAt: now
      };

      const written = await persist([...(await load()), record]);
      return Result.isError(written)
         ? Result.err<InstallRecord, FilesystemProblem>(written.error)
         : Result.ok<InstallRecord, FilesystemProblem>(record);
   }

   async function update(installId: InstallId, patch: { name?: string; pinned?: boolean; color?: string | null; store?: StoreKind }) {
      const current = await load();
      const existing = current.find((record) => record.id === installId);
      if (!existing) return Result.ok<InstallRecord | null, FilesystemProblem>(null);

      const updated: InstallRecord = {
         ...existing,
         ...(patch.name === undefined ? {} : { name: patch.name }),
         ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
         ...(patch.color === undefined ? {} : { color: patch.color }),
         ...(patch.store === undefined ? {} : { store: patch.store }),
         updatedAt: new Date().toISOString()
      };

      const written = await persist(current.map((record) => (record.id === installId ? updated : record)));
      return Result.isError(written)
         ? Result.err<InstallRecord | null, FilesystemProblem>(written.error)
         : Result.ok<InstallRecord | null, FilesystemProblem>(updated);
   }

   async function remove(installId: InstallId) {
      const current = await load();
      if (!current.some((record) => record.id === installId)) return Result.ok<void, FilesystemProblem>(undefined);

      const written = await persist(current.filter((record) => record.id !== installId));
      return Result.isError(written) ? Result.err<void, FilesystemProblem>(written.error) : Result.ok<void, FilesystemProblem>(undefined);
   }

   async function reorder(installIds: InstallId[]) {
      const current = await load();
      const order = new Map(installIds.map((installId, index) => [installId, index]));
      const next = [...current].sort((left, right) => {
         const leftIndex = order.get(left.id);
         const rightIndex = order.get(right.id);

         if (leftIndex === undefined) return rightIndex === undefined ? 0 : 1;
         if (rightIndex === undefined) return -1;
         return leftIndex - rightIndex;
      });

      return next.every((record, index) => record.id === current[index]?.id) ? Result.ok<InstallRecord[], FilesystemProblem>(current) : persist(next);
   }

   async function persist(next: InstallRecord[]) {
      const written = await writeJsonFileAtomic(filePath, { schemaVersion: installStoreFileVersion, installs: next }, installStoreFileSchema, {
         root: options.dataPath,
         scope: 'settings'
      });

      if (Result.isError(written)) return Result.err<InstallRecord[], FilesystemProblem>(written.error);

      records = next;
      return Result.ok<InstallRecord[], FilesystemProblem>(next);
   }

   return { load, find, findByPath, resolveStoreCandidates, register, update, reorder, remove, filePath };
}

function matchesStoreRecord(record: InstallRecord, id: string, key: string, candidate: StoreInstallCandidate) {
   if (record.id === id || record.key === key || record.aliases.includes(key)) return true;

   return Boolean(candidate.appId) && record.targetId === candidate.targetId && record.store === candidate.store && record.appId === candidate.appId;
}
