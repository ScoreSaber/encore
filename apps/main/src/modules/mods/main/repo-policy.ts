import { Result } from 'better-result';
import { z } from 'zod';

import { readJsonFileOrDefault, writeJsonFileAtomic } from '@/lib/filesystem/json';
import { fetchJsonDocument, type JsonDocumentFetch } from '@/lib/http/json';
import { createSerialQueue } from '@/lib/state/machine';
import {
   modRepositoryPolicyHost,
   modRepositoryPolicySchemaVersion,
   modRepositoryPolicyUrl,
   type ModRepositoryPolicyState
} from '@/modules/mods/contract';
import { repositoryUrlHost } from '@/modules/mods/main/repo-url';

import { join } from 'node:path';

const policyFileName = 'mod-repository-policy.json';
const refreshIntervalMs = 15 * 60 * 1000;
const retryAfterFailureMs = 5 * 60 * 1000;
const maxPolicyBytes = 2 * 1024 * 1024;

const modRepositoryDenylistEntrySchema = z.object({
   reason: z.string().trim().min(1).max(200),
   addedAt: z.string().trim().min(1).max(64),
   id: z.string().trim().min(1).max(120).nullish(),
   host: z.string().trim().min(1).max(253).nullish(),
   listingUrl: z.string().trim().min(1).max(2048).nullish(),
   detailsUrl: z.string().trim().min(1).max(2048).nullish()
});

const modRepositoryPolicySchema = z.object({
   schemaVersion: z.literal(modRepositoryPolicySchemaVersion),
   version: z.int().nonnegative(),
   updatedAt: z.string().trim().min(1).max(64),
   expiresAt: z.string().trim().min(1).max(64),
   entries: z.array(modRepositoryDenylistEntrySchema.nullable().catch(null)).max(2_000).default([])
});

const cachedPolicyFileSchema = z.object({
   document: modRepositoryPolicySchema,
   checkedAt: z.string(),
   etag: z.string().nullable().default(null),
   lastModified: z.string().nullable().default(null)
});

type ModRepositoryDenylistEntry = z.infer<typeof modRepositoryDenylistEntrySchema>;
export type ModRepositoryPolicy = z.infer<typeof modRepositoryPolicySchema>;

export type ModRepositoryPolicySnapshot = {
   state: ModRepositoryPolicyState;
   version: number | null;
   updatedAt: string | null;
   checkedAt: string | null;
   entries: ModRepositoryDenylistEntry[];
   detail?: string;
};

type ModRepositoryPolicyOptions = {
   dataPath: string;
   fetchJson?: JsonDocumentFetch;
   now: () => number;
};

type CachedPolicy = z.infer<typeof cachedPolicyFileSchema>;
type PolicyLoadState =
   | { status: 'unloaded' }
   | { status: 'loading'; promise: Promise<CachedPolicy | null> }
   | { status: 'loaded'; cached: CachedPolicy | null };

export function createModRepositoryPolicyService(options: ModRepositoryPolicyOptions) {
   const policyPath = join(options.dataPath, policyFileName);
   const now = options.now;
   const writeQueue = createSerialQueue();
   let loadState: PolicyLoadState = { status: 'unloaded' };
   let refreshPending: Promise<ModRepositoryPolicySnapshot> | null = null;
   let lastDetail: string | undefined;
   let failedAt = Number.NEGATIVE_INFINITY;

   async function get(): Promise<ModRepositoryPolicySnapshot> {
      const current = await load();
      if (current && now() - Date.parse(current.checkedAt) < refreshIntervalMs) return describe(current);
      if (now() - failedAt < retryAfterFailureMs) return describe(current);

      return refresh();
   }

   function refresh(): Promise<ModRepositoryPolicySnapshot> {
      if (refreshPending) return refreshPending;

      const started = runRefresh().finally(() => {
         if (refreshPending === started) refreshPending = null;
      });
      refreshPending = started;
      return started;
   }

   async function runRefresh(): Promise<ModRepositoryPolicySnapshot> {
      const current = await load();
      const document = await fetchJsonDocument({
         url: modRepositoryPolicyUrl,
         policy: { allowedHosts: [modRepositoryPolicyHost] },
         etag: current?.etag,
         lastModified: current?.lastModified,
         maxBytes: maxPolicyBytes,
         fetchJson: options.fetchJson
      });

      if (Result.isError(document)) {
         failedAt = now();
         lastDetail = document.error.detail ? `${document.error.message} (${document.error.detail})` : document.error.message;
         return describe(current);
      }

      if (document.value.status === 'not-modified') {
         if (!current) return describe(null);

         failedAt = Number.NEGATIVE_INFINITY;
         lastDetail = undefined;
         return describe(await store({ ...current, checkedAt: new Date(now()).toISOString() }));
      }

      const parsed = modRepositoryPolicySchema.safeParse(document.value.value);
      if (!parsed.success) {
         failedAt = now();
         lastDetail = 'the policy document could not be read';
         return describe(current);
      }

      if (current && parsed.data.version < current.document.version) {
         failedAt = now();
         lastDetail = 'the policy document went backwards, so the copy on disk is kept';
         return describe(current);
      }

      failedAt = Number.NEGATIVE_INFINITY;
      lastDetail = undefined;

      return describe(
         await store({
            document: parsed.data,
            checkedAt: new Date(now()).toISOString(),
            etag: document.value.etag,
            lastModified: document.value.lastModified
         })
      );
   }

   async function load() {
      if (loadState.status === 'loaded') return loadState.cached;
      if (loadState.status === 'loading') return loadState.promise;

      const promise = readJsonFileOrDefault(policyPath, cachedPolicyFileSchema.nullable(), {
         defaultValue: null
      }).then(
         (cached) => {
            loadState = { status: 'loaded', cached };
            return cached;
         },
         (error) => {
            loadState = { status: 'unloaded' };
            throw error;
         }
      );
      loadState = { status: 'loading', promise };

      return promise;
   }

   async function store(next: CachedPolicy) {
      loadState = { status: 'loaded', cached: next };
      await writeQueue.run(() => writeJsonFileAtomic(policyPath, next, cachedPolicyFileSchema, { root: options.dataPath }));

      return next;
   }

   function describe(current: CachedPolicy | null): ModRepositoryPolicySnapshot {
      if (!current) {
         const snapshot: ModRepositoryPolicySnapshot = {
            state: 'unavailable',
            version: null,
            updatedAt: null,
            checkedAt: null,
            entries: []
         };
         if (lastDetail) snapshot.detail = lastDetail;
         return snapshot;
      }

      const expiresAt = Date.parse(current.document.expiresAt);
      const expired = Number.isNaN(expiresAt) || expiresAt <= now();

      const snapshot: ModRepositoryPolicySnapshot = {
         state: expired ? 'stale' : 'ready',
         version: current.document.version,
         updatedAt: current.document.updatedAt,
         checkedAt: current.checkedAt,
         entries: current.document.entries.filter((entry) => entry !== null)
      };
      if (lastDetail) snapshot.detail = lastDetail;
      return snapshot;
   }

   return { get, refresh };
}

export function findDenylistEntry(entries: ModRepositoryDenylistEntry[], repository: { id: string; listingUrl: string }) {
   const id = repository.id.trim().toLowerCase();
   const listingUrl = repository.listingUrl.trim().toLowerCase();
   const host = repositoryUrlHost(repository.listingUrl);

   return (
      entries.find((entry) => {
         if (entry.id && entry.id.trim().toLowerCase() === id) return true;
         if (entry.listingUrl && entry.listingUrl.trim().toLowerCase() === listingUrl) return true;

         return Boolean(entry.host && host && entry.host.trim().toLowerCase() === host);
      }) ?? null
   );
}

export function isDeniedHost(entries: ModRepositoryDenylistEntry[], host: string) {
   const deniedHost = host.trim().toLowerCase();

   return entries.some((entry) => entry.host?.trim().toLowerCase() === deniedHost);
}
