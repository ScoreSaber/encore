import { Result } from 'better-result';

import { withApk } from '@/lib/android/apk-archive';
import { signApkV2, type ApkSigningKey } from '@/lib/android/apk-signing';
import { parseAxml, serializeAxml } from '@/lib/android/axml';
import { createProblem, type Problem } from '@/lib/errors';
import { applyModdingManifestPatch, readManifestVersionName } from '@/modules/quest/main/android-manifest';
import { scotland2Version } from '@/modules/quest/main/quest-patch-resources';

import { readFile } from 'node:fs/promises';

const manifestPath = 'AndroidManifest.xml';
const libMainPath = 'lib/arm64-v8a/libmain.so';
const libUnityPath = 'lib/arm64-v8a/libunity.so';
const libOvrPlatformLoaderPath = 'lib/arm64-v8a/libovrplatformloader.so';
const modTagPath = 'modded.json';

const legacySignaturePattern = /^META-INF\/(MANIFEST\.MF|[^/]+\.(SF|RSA|DSA|EC))$/;

export function rewriteApk(
   path: string,
   contents: {
      libMain: string;
      libUnity: string | null;
      libOvrPlatformLoader: string | null;
      legacyDevice: boolean;
      appVersion: string;
      key: ApkSigningKey;
      onSign: () => Result<void, Problem>;
   }
) {
   return withApk(
      path,
      (cause) => createProblem('quest.patch.apk-patch-failed', { cause }),
      (archive) =>
         Result.gen(async function* () {
            const manifest = yield* parseAxml(await archive.read(manifestPath));
            archive.write(manifestPath, serializeAxml(yield* applyModdingManifestPatch(manifest, { legacyDevice: contents.legacyDevice })));
            archive.write(libMainPath, await readFile(contents.libMain));
            archive.write(
               modTagPath,
               Buffer.from(
                  JSON.stringify(
                     {
                        patcher_name: 'Encore',
                        patcher_version: contents.appVersion,
                        modloader_name: 'Scotland2',
                        modloader_version: scotland2Version
                     },
                     null,
                     2
                  )
               )
            );
            if (contents.libUnity) archive.write(libUnityPath, await readFile(contents.libUnity));
            if (contents.libOvrPlatformLoader) archive.write(libOvrPlatformLoaderPath, await readFile(contents.libOvrPlatformLoader));
            for (const name of [...archive.entries.keys()].filter((name) => legacySignaturePattern.test(name))) archive.remove(name);
            yield* contents.onSign();
            await signApkV2(archive, contents.key);
            return Result.ok();
         })
   );
}

export function readApkVersion(path: string) {
   return withApk(
      path,
      (cause) => createProblem('quest.patch.apk-unreadable', { cause }),
      async (archive) => parseAxml(await archive.read(manifestPath)).map(readManifestVersionName)
   );
}
