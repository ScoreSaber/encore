import { Result } from 'better-result';
import { z } from 'zod';

import { parseAxml } from '@/lib/android/axml';
import { openZipArchive, zipCompressionDeflate, zipCompressionStored } from '@/lib/archive/zip-read';
import { downloadContent } from '@/lib/content/content-download';
import { createProblem, type Problem } from '@/lib/errors';
import { fetchJsonResource } from '@/lib/http/json';
import { downloadHostsFor } from '@/lib/http/url';
import { encorePackageId } from '@/modules/quest/contract';
import { encoreReleasesUrl } from '@/modules/updates/contract';

const maxApkBytes = 512 * 1024 * 1024;
const maxManifestBytes = 4 * 1024 * 1024;
const latestReleaseUrl = 'https://api.github.com/repos/ScoreSaber/encore/releases/latest';
const releaseSchema = z.object({
   tag_name: z.string().regex(/^v\d+\.\d+\.\d+$/),
   assets: z.array(z.object({ name: z.string(), digest: z.string().nullish() }))
});

export async function downloadCompanionApk(path: string): Promise<Result<void, Problem>> {
   const release = await fetchJsonResource({ url: latestReleaseUrl, schema: releaseSchema });
   if (Result.isError(release)) {
      return Result.err(createProblem('quest.apk.release-failed', { cause: release.error.detail ?? release.error.message }));
   }

   const { tag_name: tag, assets } = release.value;
   const name = `Encore-${tag.slice(1)}-quest.apk`;
   const asset = assets.find((asset) => asset.name === name);
   if (!asset) return Result.err(createProblem('quest.apk.release-missing'));
   if (!asset.digest) return Result.err(createProblem('quest.apk.integrity-failed'));

   const downloaded = await downloadContent({
      url: `${encoreReleasesUrl}/download/${tag}/${name}`,
      destinationPath: path,
      limits: { maxDownloadBytes: maxApkBytes },
      policy: { allowedHosts: downloadHostsFor('github.com') }
   });
   if (Result.isError(downloaded)) return Result.err(downloaded.error);
   if (`sha256:${downloaded.value.sha256}` !== asset.digest) return Result.err(createProblem('quest.apk.integrity-failed'));

   return validateCompanionApk(path);
}

async function validateCompanionApk(path: string): Promise<Result<void, Problem>> {
   const archive = await openZipArchive(path, { maxEntries: 16_384 });
   if (Result.isError(archive)) return Result.err(createProblem('quest.apk.invalid'));
   try {
      const manifests = archive.value.records.filter((record) => record.name === 'AndroidManifest.xml');
      const manifest = manifests[0];
      if (
         manifests.length !== 1 ||
         !manifest ||
         manifest.encrypted ||
         manifest.uncompressedBytes > maxManifestBytes ||
         ![zipCompressionStored, zipCompressionDeflate].includes(manifest.compressionMethod)
      ) {
         return Result.err(createProblem('quest.apk.manifest-unreadable'));
      }
      const stream = await archive.value.openEntryStream(manifest);
      if (Result.isError(stream)) return Result.err(createProblem('quest.apk.manifest-unreadable'));
      const read = Result.flatten(
         await Result.tryPromise({
            try: async () => {
               const chunks: Uint8Array[] = [];
               let bytes = 0;
               for await (const chunk of stream.value) {
                  const contents = z.instanceof(Uint8Array).parse(chunk);
                  bytes += contents.byteLength;
                  if (bytes > maxManifestBytes) {
                     stream.value.destroy();
                     return Result.err<Buffer, Problem>(createProblem('quest.apk.manifest-too-large'));
                  }
                  chunks.push(contents);
               }
               return Result.ok<Buffer, Problem>(Buffer.concat(chunks));
            },
            catch: (cause) => createProblem('quest.apk.manifest-unreadable', { cause })
         })
      );
      if (Result.isError(read)) return Result.err(read.error);
      const parsed = parseAxml(read.value);
      if (Result.isError(parsed)) return Result.err(createProblem('quest.apk.manifest-unreadable'));
      const root = parsed.value.find((event) => event.kind === 'start-element');
      if (root?.name !== 'manifest') {
         return Result.err(createProblem('quest.apk.manifest-unreadable'));
      }
      const packageNames = root.attributes.filter((attribute) => attribute.namespace === null && attribute.name === 'package');
      const packageName = packageNames[0];
      if (packageNames.length !== 1 || packageName?.value.type !== 'string' || packageName.value.value !== encorePackageId) {
         return Result.err(createProblem('quest.apk.wrong-package', { packageId: encorePackageId }));
      }
      return Result.ok(undefined);
   } finally {
      archive.value.close();
   }
}
