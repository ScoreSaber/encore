import { Result } from 'better-result';
import { z } from 'zod';

import { readJsonFileOrDefault, writeJsonFileAtomic } from '@/lib/filesystem/json';
import { fetchJsonDocument, type JsonDocumentFetch } from '@/lib/http/json';
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
const maxPolicyBytes = 2 * 1024 * 1024;

export const modRepositoryDenylistEntrySchema = z.object({
   reason: z.string().trim().min(1).max(200),
   addedAt: z.string().trim().min(1).max(64),
   id: z.string().trim().min(1).max(120).nullish(),
   host: z.string().trim().min(1).max(253).nullish(),
   listingUrl: z.string().trim().min(1).max(2048).nullish(),
   detailsUrl: z.string().trim().min(1).max(2048).nullish()
});

export const modRepositoryPolicySchema = z.object({
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

export type ModRepositoryDenylistEntry = z.infer<typeof modRepositoryDenylistEntrySchema>;
export type ModRepositoryPolicy = z.infer<typeof modRepositoryPolicySchema>;

export type ModRepositoryPolicySnapshot = {
   state: ModRepositoryPolicyState;
   version: number | null;
   updatedAt: string | null;
   checkedAt: string | null;
   entries: ModRepositoryDenylistEntry[];
   detail?: string;
};

export type ModRepositoryPolicyOptions = {
   dataPath: string;
   url?: string;
   fetchJson?: JsonDocumentFetch;
   now?: () => number;
};

export type ModRepositoryPolicyService = ReturnType<typeof createModRepositoryPolicyService>;

type CachedPolicy = z.infer<typeof cachedPolicyFileSchema>;

export function createModRepositoryPolicyService(options: ModRepositoryPolicyOptions) {
   const policyPath = join(options.dataPath, policyFileName);
   const url = options.url ?? modRepositoryPolicyUrl;
   const now = options.now ?? Date.now;
   let cached: CachedPolicy | null = null;
   let loaded = false;
   let lastDetail: string | undefined;

   async function get(): Promise<ModRepositoryPolicySnapshot> {
      const current = await load();
      if (current && now() - Date.parse(current.checkedAt) < refreshIntervalMs) return describe(current);

      return refresh();
   }

   async function refresh(): Promise<ModRepositoryPolicySnapshot> {
      const current = await load();
      const document = await fetchJsonDocument({
         url,
         policy: { allowedHosts: [modRepositoryPolicyHost] },
         etag: current?.etag,
         lastModified: current?.lastModified,
         maxBytes: maxPolicyBytes,
         fetchJson: options.fetchJson
      });

      if (Result.isError(document)) {
         lastDetail = document.error.detail ? `${document.error.message} (${document.error.detail})` : document.error.message;
         return describe(current);
      }

      if (document.value.status === 'not-modified') {
         if (!current) return describe(null);

         lastDetail = undefined;
         return describe(await store({ ...current, checkedAt: new Date(now()).toISOString() }));
      }

      const parsed = modRepositoryPolicySchema.safeParse(document.value.value);
      if (!parsed.success) {
         lastDetail = 'the policy document could not be read';
         return describe(current);
      }

      if (current && parsed.data.version < current.document.version) {
         lastDetail = 'the policy document went backwards, so the copy on disk is kept';
         return describe(current);
      }

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
      if (loaded) return cached;

      loaded = true;
      cached = await readJsonFileOrDefault(policyPath, cachedPolicyFileSchema.nullable(), {
         defaultValue: null
      });

      return cached;
   }

   async function store(next: CachedPolicy) {
      cached = next;
      await writeJsonFileAtomic(policyPath, next, cachedPolicyFileSchema, { root: options.dataPath, scope: 'settings' });

      return next;
   }

   function describe(current: CachedPolicy | null): ModRepositoryPolicySnapshot {
      if (!current) {
         return {
            state: 'unavailable',
            version: null,
            updatedAt: null,
            checkedAt: null,
            entries: [],
            ...(lastDetail ? { detail: lastDetail } : {})
         };
      }

      const expiresAt = Date.parse(current.document.expiresAt);
      const expired = Number.isNaN(expiresAt) || expiresAt <= now();

      return {
         state: expired ? 'stale' : 'ready',
         version: current.document.version,
         updatedAt: current.document.updatedAt,
         checkedAt: current.checkedAt,
         entries: current.document.entries.filter((entry) => entry !== null),
         ...(lastDetail ? { detail: lastDetail } : {})
      };
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
