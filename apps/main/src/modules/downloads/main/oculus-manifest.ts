import { Result } from 'better-result';
import { unzipSync } from 'fflate';
import { z } from 'zod';

const metaBinaryHost = 'https://securecdn.oculus.com';

// compressed input and inflated output are independently bounded to reject archive bombs
export const maxManifestEntryBytes = 16 * 1024 * 1024;
export const maxSegmentBytes = 256 * 1024 * 1024;
export const maxManifestFiles = 20_000;
export const maxManifestSegments = 200_000;
export const maxManifestTotalBytes = 512 * 1024 * 1024 * 1024;

export const oculusManifestSegmentSchema = z.tuple([z.int().nonnegative(), z.string().min(1), z.int().positive().max(maxSegmentBytes)]);

export const oculusManifestFileSchema = z.object({
   sha256: z.string().min(1),
   size: z.int().nonnegative(),
   segments: z.array(oculusManifestSegmentSchema).max(maxManifestSegments)
});

export const oculusManifestSchema = z
   .object({
      files: z.record(z.string().min(1), oculusManifestFileSchema)
   })
   .superRefine(({ files }, context) => {
      const entries = Object.values(files);
      if (entries.length > maxManifestFiles) {
         context.addIssue({ code: 'custom', message: 'the manifest lists too many files', path: ['files'] });
         return;
      }

      let segments = 0;
      let declaredBytes = 0;
      let compressedBytes = 0;

      for (const file of entries) {
         segments += file.segments.length;
         declaredBytes += file.size;
         for (const segment of file.segments) compressedBytes += segment[2];

         if (segments > maxManifestSegments || declaredBytes > maxManifestTotalBytes || compressedBytes > maxManifestTotalBytes) {
            context.addIssue({ code: 'custom', message: 'the manifest declares too much content', path: ['files'] });
            return;
         }
      }
   });

export type OculusManifest = z.infer<typeof oculusManifestSchema>;
export type OculusManifestFile = z.infer<typeof oculusManifestFileSchema>;

export function metaManifestUrl(binaryId: string, accessToken: string) {
   // Meta requires the token in the query string; callers must not log this URL
   return `${metaBinaryHost}/binaries/download/?id=${encodeURIComponent(binaryId)}&access_token=${encodeURIComponent(accessToken)}&get_manifest=1`;
}

export function metaSegmentUrl(binaryId: string, accessToken: string, segmentSha256: string) {
   return `${metaBinaryHost}/binaries/segment/?access_token=${encodeURIComponent(accessToken)}&binary_id=${encodeURIComponent(binaryId)}&segment_sha256=${encodeURIComponent(segmentSha256)}`;
}

export function readZipEntry(archive: Buffer, entryName: string, maxBytes = maxManifestEntryBytes): Result<Buffer, string> {
   let oversized = false;
   const unpacked = Result.try({
      try: () =>
         unzipSync(archive, {
            filter: (file) => {
               if (file.name !== entryName) return false;

               oversized = file.originalSize > maxBytes;
               return !oversized;
            }
         }),
      catch: () => 'the archive could not be read'
   });
   if (Result.isError(unpacked)) return Result.err<Buffer, string>(unpacked.error);
   if (oversized) return Result.err<Buffer, string>(`the "${entryName}" entry is larger than the manifest cap`);

   const entry = unpacked.value[entryName];
   if (!entry) return Result.err<Buffer, string>(`the archive has no "${entryName}" entry`);
   if (entry.byteLength > maxBytes) return Result.err<Buffer, string>(`the "${entryName}" entry is larger than the manifest cap`);

   return Result.ok<Buffer, string>(Buffer.from(entry));
}

export function parseOculusManifest(archive: Buffer) {
   const entry = readZipEntry(archive, 'manifest.json');
   if (Result.isError(entry)) return Result.err<OculusManifest, string>(entry.error);

   const json = Result.try({
      try: (): unknown => JSON.parse(entry.value.toString('utf8')),
      catch: () => 'the manifest was not valid JSON'
   });
   if (Result.isError(json)) return Result.err<OculusManifest, string>(json.error);

   const parsed = oculusManifestSchema.safeParse(json.value);
   if (!parsed.success) return Result.err<OculusManifest, string>('the manifest did not list downloadable files');

   return Result.ok<OculusManifest, string>(parsed.data);
}
