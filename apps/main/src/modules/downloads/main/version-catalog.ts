import { Result } from 'better-result';
import { z } from 'zod';

import { createProblem } from '@/lib/errors';
import { readJsonFileOrDefault, writeJsonFileAtomic } from '@/lib/filesystem/json';
import { fetchJsonResource, type JsonDocumentFetch, type JsonDocumentProblem } from '@/lib/http/json';
import {
   defaultVersionCatalogUrl,
   downloadCatalogCacheSchema,
   downloadCatalogCacheVersion,
   downloadVersionSchema,
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
      if (Result.isError(fetched)) return { ...(await loadCurrent()), problem: toCatalogProblem(fetched.error) };

      const versions = newestFirst(fetched.value);
      if (versions.length === 0) return { ...(await loadCurrent()), problem: createProblem('downloads.catalog.empty') };

      const updatedAt = new Date().toISOString();
      const written = await writeJsonFileAtomic(
         cachePath,
         { schemaVersion: downloadCatalogCacheVersion, sourceUrl, updatedAt, versions },
         downloadCatalogCacheSchema,
         {
            root: options.dataPath
         }
      );

      const ready: DownloadCatalogSnapshot = {
         status: 'ready',
         source: 'remote',
         sourceUrl,
         updatedAt,
         versions
      };
      snapshot = ready;
      if (Result.isError(written)) {
         return { ...ready, problem: createProblem('downloads.catalog.write-failed', { detail: written.error.detail }) };
      }

      return ready;
   }

   async function loadCurrent(): Promise<DownloadCatalogSnapshot> {
      if (snapshot) return snapshot;

      const cached = await readJsonFileOrDefault(cachePath, downloadCatalogCacheSchema.nullable(), { defaultValue: null });
      if (snapshot) return snapshot;
      if (!cached || cached.versions.length === 0) return { status: 'unavailable', source: null, sourceUrl, updatedAt: null, versions: [] };

      snapshot = { status: 'ready', source: 'cache', sourceUrl, updatedAt: cached.updatedAt, versions: cached.versions };
      return snapshot;
   }

   return { get, refresh };
}

function toCatalogProblem(problem: JsonDocumentProblem) {
   const invalid = problem.code === 'json.unexpected-shape' || problem.code === 'json.invalid';
   return createProblem(invalid ? 'downloads.catalog.invalid' : 'downloads.catalog.fetch-failed', { detail: problem.detail });
}

function newestFirst(entries: (DownloadVersion | null)[]) {
   const versions = new Map<string, DownloadVersion>();

   for (const entry of entries) {
      if (entry) versions.set(entry.version, entry);
   }

   return [...versions.values()].reverse();
}
