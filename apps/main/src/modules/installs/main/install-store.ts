import { Result } from 'better-result';
import { z } from 'zod';

import { readJsonFile, writeJsonFileAtomic } from '@/lib/filesystem/json';
import { isSamePath, resolveFilesystemPath, type FilesystemProblem } from '@/lib/filesystem/path';
import { createSerialQueue } from '@/lib/state/machine';
import { installSourceSchema, type InstallId, type InstallSource } from '@/modules/installs/contract';
import { customInstallName } from '@/modules/installs/main/naming';
import { storeKindSchema, type StoreInstallCandidate, type StoreKind } from '@/modules/stores/contract';
import { localTargetId } from '@/modules/targets/contract';

import { createHash, randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';

const installStoreFileVersion = 1;
const installStoreFileName = 'installs.json';

const installRecordSchema = z.object({
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
   createdAt: z.string(),
   updatedAt: z.string()
});

const installStoreFileSchema = z.object({
   schemaVersion: z.literal(installStoreFileVersion),
   installs: z.array(installRecordSchema)
});

export type InstallRecord = z.infer<typeof installRecordSchema>;

export type InstallRegistration = {
   source: InstallSource;
   path: string;
   color?: string | null;
   store?: StoreKind | null;
};

export type InstallRecordPatch = {
   name?: string;
   pinned?: boolean;
   color?: string | null;
   path?: string;
};

function storeInstallKey(candidate: StoreInstallCandidate) {
   const app = candidate.appId ?? basename(candidate.path);
   return `local|${candidate.store}|${app}|${resolveFilesystemPath(candidate.libraryPath)}`;
}

function createInstallId(key: string) {
   return `install_${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
}

export function createInstallStore(options: { dataPath: string }) {
   const filePath = join(options.dataPath, installStoreFileName);
   let records: InstallRecord[] | null = null;
   const queue = createSerialQueue();

   async function loadInternal() {
      if (records) return Result.ok<InstallRecord[], FilesystemProblem>([...records]);

      const read = await readJsonFile(filePath, installStoreFileSchema, {
         defaultValue: { schemaVersion: installStoreFileVersion, installs: [] }
      });
      if (Result.isError(read)) return Result.err<InstallRecord[], FilesystemProblem>(read.error);

      records = read.value.installs;
      return Result.ok<InstallRecord[], FilesystemProblem>([...records]);
   }

   async function resolveStoreCandidates(candidates: StoreInstallCandidate[]) {
      const loaded = await loadInternal();
      if (Result.isError(loaded)) return loaded;
      const current = loaded.value;
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

         const record: InstallRecord = {
            id: existing?.id ?? id,
            targetId: localTargetId,
            source: 'store',
            name: existing?.name ?? customInstallName(basename(path)),
            pinned: existing?.pinned ?? false,
            color: existing?.color ?? null,
            store: candidate.store,
            path,
            key,
            aliases,
            libraryPath,
            createdAt: existing?.createdAt ?? now,
            updatedAt: existing && unchanged ? existing.updatedAt : now
         };
         if (candidate.appId) record.appId = candidate.appId;
         next.push(record);

         changed ||= !unchanged;
      }

      next.sort((left, right) => (currentOrder.get(left.id) ?? current.length) - (currentOrder.get(right.id) ?? current.length));

      changed ||= current.some((record) => record.source === 'store' && !next.some((candidate) => candidate.id === record.id));

      return changed ? persist(next) : Result.ok<InstallRecord[], FilesystemProblem>(next);
   }

   async function register(registration: InstallRegistration) {
      const loaded = await loadInternal();
      if (Result.isError(loaded)) return Result.err<InstallRecord, FilesystemProblem>(loaded.error);

      const path = resolveFilesystemPath(registration.path);
      const existing = loaded.value.find((record) => isSamePath(record.path, path));
      if (existing) return Result.ok<InstallRecord, FilesystemProblem>(existing);

      const now = new Date().toISOString();
      const record: InstallRecord = {
         id: randomUUID(),
         targetId: localTargetId,
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

      const written = await persist([...loaded.value, record]);
      return Result.isError(written)
         ? Result.err<InstallRecord, FilesystemProblem>(written.error)
         : Result.ok<InstallRecord, FilesystemProblem>(record);
   }

   async function update(installId: InstallId, patch: InstallRecordPatch & { store?: StoreKind }) {
      const loaded = await loadInternal();
      if (Result.isError(loaded)) return Result.err<InstallRecord | null, FilesystemProblem>(loaded.error);
      const current = loaded.value;
      const existing = current.find((record) => record.id === installId);
      if (!existing) return Result.ok<InstallRecord | null, FilesystemProblem>(null);

      const updated: InstallRecord = { ...existing, updatedAt: new Date().toISOString() };
      if (patch.name !== undefined) updated.name = patch.name;
      if (patch.pinned !== undefined) updated.pinned = patch.pinned;
      if (patch.color !== undefined) updated.color = patch.color;
      if (patch.path !== undefined) updated.path = resolveFilesystemPath(patch.path);
      if (patch.store !== undefined) updated.store = patch.store;

      const written = await persist(current.map((record) => (record.id === installId ? updated : record)));
      return Result.isError(written)
         ? Result.err<InstallRecord | null, FilesystemProblem>(written.error)
         : Result.ok<InstallRecord | null, FilesystemProblem>(updated);
   }

   async function remove(installId: InstallId) {
      const loaded = await loadInternal();
      if (Result.isError(loaded)) return Result.err<void, FilesystemProblem>(loaded.error);
      const current = loaded.value;
      if (!current.some((record) => record.id === installId)) return Result.ok<void, FilesystemProblem>(undefined);

      const written = await persist(current.filter((record) => record.id !== installId));
      return Result.isError(written) ? Result.err<void, FilesystemProblem>(written.error) : Result.ok<void, FilesystemProblem>(undefined);
   }

   async function reorder(installIds: InstallId[]) {
      const loaded = await loadInternal();
      if (Result.isError(loaded)) return loaded;
      const current = loaded.value;
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
         root: options.dataPath
      });

      if (Result.isError(written)) return Result.err<InstallRecord[], FilesystemProblem>(written.error);

      records = next;
      return Result.ok<InstallRecord[], FilesystemProblem>([...next]);
   }

   return {
      load: () => queue.run(loadInternal),
      resolveStoreCandidates: (candidates: StoreInstallCandidate[]) => queue.run(() => resolveStoreCandidates(candidates)),
      register: (registration: InstallRegistration) => queue.run(() => register(registration)),
      update: (installId: InstallId, patch: InstallRecordPatch & { store?: StoreKind }) => queue.run(() => update(installId, patch)),
      reorder: (installIds: InstallId[]) => queue.run(() => reorder(installIds)),
      remove: (installId: InstallId) => queue.run(() => remove(installId)),
      filePath
   };
}

function matchesStoreRecord(record: InstallRecord, id: string, key: string, candidate: StoreInstallCandidate) {
   if (record.id === id || record.key === key || record.aliases.includes(key)) return true;

   return Boolean(candidate.appId) && record.targetId === localTargetId && record.store === candidate.store && record.appId === candidate.appId;
}
