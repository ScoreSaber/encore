import { Result } from 'better-result';
import { z } from 'zod';

import { downloadContent } from '@/lib/content/content-download';
import { causeCode, createProblem, type Problem } from '@/lib/errors';
import { publishAtomic } from '@/lib/filesystem/atomic-write';
import { downloadHostsFor } from '@/lib/http/url';
import { beatSaberPackageId } from '@/modules/quest/contract';
import { fetchQuestJson, type QuestCatalogFetchJson } from '@/modules/quest/main/quest-mod-catalog';

import { stat } from 'node:fs/promises';
import { join } from 'node:path';

const libMainLoaderVersion = '0.2.0';
export const scotland2Version = '0.1.7';

const libMainLoaderUrl = `https://github.com/sc2ad/LibMainLoader/releases/download/v${libMainLoaderVersion}/libmain.so`;
const scotland2Url = `https://github.com/sc2ad/scotland2/releases/download/v${scotland2Version}/libsl2.so`;
const legacyOvrPlatformLoaderUrl = 'https://raw.githubusercontent.com/kodenamekrak/JusticeForQuest/master/third_party/libovrplatformloader.so';

const unityIndexUrl = 'https://raw.githubusercontent.com/Lauriethefish/QuestUnstrippedUnity/main/index.json';
const unityVersionsBaseUrl = 'https://raw.githubusercontent.com/Lauriethefish/QuestUnstrippedUnity/main/versions';

const maxLibraryBytes = 128 * 1024 * 1024;

const unityIndexSchema = z.record(z.string(), z.record(z.string(), z.string().regex(/^[a-z\d][a-z\d._+-]{0,127}$/i)));

type QuestResourceDownload = (input: {
   url: string;
   destinationPath: string;
   allowedHosts: readonly string[];
   signal: AbortSignal;
}) => Promise<Result<void, Problem>>;

export type QuestPatchResources = ReturnType<typeof createQuestPatchResources>;

export function createQuestPatchResources(options: { cacheRoot: string; download?: QuestResourceDownload; fetchJson?: QuestCatalogFetchJson }) {
   const download = options.download ?? defaultDownload;
   const fetchJson = options.fetchJson ?? fetchQuestJson;

   async function cached(name: string, url: string, signal: AbortSignal): Promise<Result<string, Problem>> {
      const path = join(options.cacheRoot, name);
      const present = await Result.tryPromise({ try: () => stat(path), catch: (cause) => cause });
      if (Result.isOk(present) && present.value.isFile() && present.value.size > 0) return Result.ok(path);
      if (Result.isError(present) && causeCode(present.error) !== 'ENOENT')
         return Result.err(createProblem('quest.patch.resource-failed', { cause: present.error }));

      return publishAtomic(path, async (partial) => {
         const downloaded = await download({ url, destinationPath: partial, allowedHosts: downloadHostsFor(new URL(url).hostname), signal });
         if (Result.isError(downloaded)) return Result.err(downloaded.error);
         const file = await Result.tryPromise({
            try: () => stat(partial),
            catch: (cause) => createProblem('quest.patch.resource-failed', { cause })
         });
         if (Result.isError(file)) return Result.err(file.error);
         return file.value.isFile() && file.value.size > 0 ? Result.ok(path) : Result.err(createProblem('quest.patch.resource-empty'));
      });
   }

   function libMainLoader(signal: AbortSignal) {
      return cached(`libmain-v${libMainLoaderVersion}.so`, libMainLoaderUrl, signal);
   }

   function scotland2(signal: AbortSignal) {
      return cached(`libsl2-v${scotland2Version}.so`, scotland2Url, signal);
   }

   function legacyOvrPlatformLoader(signal: AbortSignal) {
      return cached('libovrplatformloader-quest1.so', legacyOvrPlatformLoaderUrl, signal);
   }

   async function unstrippedUnity(gameVersion: string, signal: AbortSignal): Promise<Result<string | null, Problem>> {
      const index = await fetchJson(unityIndexUrl);
      if (Result.isError(index)) return Result.err(index.error);

      const parsed = unityIndexSchema.safeParse(index.value);
      if (!parsed.success) return Result.err(createProblem('quest.patch.unity-index-invalid'));
      const unityVersion = parsed.data[beatSaberPackageId]?.[gameVersion];
      return unityVersion
         ? cached(`libunity-${unityVersion}.so`, `${unityVersionsBaseUrl}/${encodeURIComponent(unityVersion)}.so`, signal)
         : Result.ok(null);
   }

   return { libMainLoader, scotland2, unstrippedUnity, legacyOvrPlatformLoader };
}

const defaultDownload: QuestResourceDownload = async (input) => {
   const downloaded = await downloadContent({
      url: input.url,
      destinationPath: input.destinationPath,
      limits: { maxDownloadBytes: maxLibraryBytes },
      policy: { allowedHosts: input.allowedHosts },
      signal: input.signal
   });

   if (Result.isError(downloaded)) {
      return Result.err(createProblem('quest.patch.download-failed', { cause: downloaded.error.detail ?? downloaded.error.message }));
   }

   return Result.ok(undefined);
};
