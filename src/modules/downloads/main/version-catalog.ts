import { Result } from 'better-result';
import { z } from 'zod';

import { readJsonFileOrDefault, writeJsonFileAtomic } from '@/lib/filesystem/json';
import { fetchJsonResource, type JsonDocumentFetch, type JsonDocumentProblem } from '@/lib/http/json';
import {
   defaultVersionCatalogUrl,
   downloadCatalogCacheSchema,
   downloadCatalogCacheVersion,
   downloadVersionSchema,
   type DownloadCatalogProblem,
   type DownloadCatalogSnapshot,
   type DownloadVersion
} from '@/modules/downloads/contract';

import { join } from 'node:path';

const cacheFileName = 'beat-saber-versions.json';
const fetchTimeoutMs = 15_000;

const remoteCatalogSchema = z.array(downloadVersionSchema.nullable().catch(null));

type VersionCatalogOptions = {
   dataPath: string;
   sourceUrl?: string;
   fetchCatalog?: JsonDocumentFetch;
};

export type VersionCatalog = ReturnType<typeof createVersionCatalog>;

export function createVersionCatalog(options: VersionCatalogOptions) {
   const sourceUrl = options.sourceUrl ?? defaultVersionCatalogUrl;
   const cachePath = join(options.dataPath, cacheFileName);
   let snapshot: DownloadCatalogSnapshot | null = null;
   let pendingRefresh: Promise<DownloadCatalogSnapshot> | null = null;

   async function get() {
      const current = await loadCurrent();
      return current.status === 'ready' ? current : refresh();
   }

   function refresh() {
      pendingRefresh ??= runRefresh().finally(() => {
         pendingRefresh = null;
      });

      return pendingRefresh;
   }

   async function runRefresh(): Promise<DownloadCatalogSnapshot> {
      const fetched = await fetchJsonResource({
         url: sourceUrl,
         schema: remoteCatalogSchema,
         timeoutMs: fetchTimeoutMs,
         fetchJson: options.fetchCatalog
      });
      if (Result.isError(fetched)) return withProblem(await loadCurrent(), toCatalogProblem(fetched.error));

      const versions = newestFirst(fetched.value);
      if (versions.length === 0) {
         return withProblem(await loadCurrent(), {
            code: 'downloads.catalog.empty',
            message: 'the Beat Saber version list had no downloadable versions'
         });
      }

      const updatedAt = new Date().toISOString();
      const written = await writeJsonFileAtomic(
         cachePath,
         { schemaVersion: downloadCatalogCacheVersion, sourceUrl, updatedAt, versions },
         downloadCatalogCacheSchema,
         {
            root: options.dataPath,
            scope: 'settings'
         }
      );

      snapshot = {
         status: 'ready',
         source: 'remote',
         sourceUrl,
         updatedAt,
         versions,
         ...(Result.isError(written)
            ? {
                 problem: {
                    code: 'downloads.catalog.write-failed',
                    message: 'the Beat Saber version list could not be cached',
                    ...(written.error.detail ? { detail: written.error.detail } : {})
                 }
              }
            : {})
      };

      return snapshot;
   }

   async function loadCurrent(): Promise<DownloadCatalogSnapshot> {
      if (snapshot) return snapshot;

      const cached = await readCache();
      if (!cached) return { status: 'unavailable', source: null, sourceUrl, updatedAt: null, versions: [] };

      snapshot = { status: 'ready', source: 'cache', sourceUrl, updatedAt: cached.updatedAt, versions: cached.versions };
      return snapshot;
   }

   async function readCache() {
      const cached = await readJsonFileOrDefault(cachePath, downloadCatalogCacheSchema.nullable(), {
         defaultValue: null
      });
      if (!cached || cached.versions.length === 0) return null;

      return cached;
   }

   return { get, refresh };
}

function withProblem(current: DownloadCatalogSnapshot, problem: DownloadCatalogProblem): DownloadCatalogSnapshot {
   return { ...current, problem };
}

function toCatalogProblem(problem: JsonDocumentProblem): DownloadCatalogProblem {
   const detail = problem.detail ? { detail: problem.detail } : {};

   if (problem.code === 'json.unexpected-shape')
      return { code: 'downloads.catalog.invalid', message: 'the Beat Saber version list was not a list', ...detail };
   if (problem.code === 'json.invalid')
      return { code: 'downloads.catalog.invalid', message: 'the Beat Saber version list was not valid JSON', ...detail };

   return { code: 'downloads.catalog.fetch-failed', message: 'the Beat Saber version list could not be downloaded', ...detail };
}

function newestFirst(entries: (DownloadVersion | null)[]) {
   const versions = new Map<string, DownloadVersion>();

   for (const entry of entries) {
      if (entry) versions.set(entry.version, entry);
   }

   return [...versions.values()].reverse();
}
