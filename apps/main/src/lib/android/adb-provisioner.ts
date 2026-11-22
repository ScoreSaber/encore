import { Result } from 'better-result';

import { execAdb } from '@/lib/android/adb';
import { openZipArchive, zipCompressionDeflate, zipCompressionStored } from '@/lib/archive/zip-read';
import { downloadContent } from '@/lib/content/content-download';
import { causeMessage, createProblem, type Problem } from '@/lib/errors';
import { removeQuietly } from '@/lib/filesystem/path';

import { constants, createWriteStream } from 'node:fs';
import { access, chmod, mkdir } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const platformToolsHost = 'dl.google.com';
const maxPlatformToolsEntries = 4096;
const provisionRetryBackoffMs = 60_000;

type ProvisionerState =
   | { status: 'idle' }
   | { status: 'resolving'; promise: Promise<Result<string, Problem>> }
   | { status: 'ready'; path: string }
   | { status: 'backoff'; until: number; error: Problem };

export type AdbProvisioner = ReturnType<typeof createAdbProvisioner>;

export function createAdbProvisioner(options: { dataPath: string }) {
   const platform = process.platform;
   const adbName = platform === 'win32' ? 'adb.exe' : 'adb';
   const managedPath = join(options.dataPath, 'platform-tools', adbName);
   let state: ProvisionerState = { status: 'idle' };

   async function resolve(): Promise<Result<string, Problem>> {
      if (state.status === 'ready') return Result.ok<string, Problem>(state.path);
      if (state.status === 'resolving') return state.promise;
      if (state.status === 'backoff' && Date.now() < state.until) return Result.err(state.error);

      const promise = locate().then((result) => {
         if (Result.isOk(result)) {
            state = { status: 'ready', path: result.value };
         } else {
            state = { status: 'backoff', until: Date.now() + provisionRetryBackoffMs, error: result.error };
         }
         return result;
      });
      state = { status: 'resolving', promise };

      return promise;
   }

   async function locate(): Promise<Result<string, Problem>> {
      for (const candidate of [await findOnPath(adbName), managedPath]) {
         if (candidate && (await works(candidate))) {
            return Result.ok<string, Problem>(candidate);
         }
      }

      if (platform === 'linux' && process.arch === 'arm64') return Result.err(createProblem('android.adb.install-system'));

      return provision();
   }

   async function works(adbPath: string) {
      const ran = await execAdb({ adbPath, args: ['version'], timeoutMs: 15_000 });
      return Result.isOk(ran) && Number(/^Version (\d+)\./m.exec(ran.value.stdout)?.[1] ?? 0) >= 30;
   }

   async function provision(): Promise<Result<string, Problem>> {
      const prepared = await Result.tryPromise({
         try: () => mkdir(options.dataPath, { recursive: true }),
         catch: (cause) => createProblem('android.adb.storage-unavailable', { cause })
      });
      if (Result.isError(prepared)) return Result.err(prepared.error);
      const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux';
      const archivePath = join(options.dataPath, 'platform-tools.zip');

      const downloaded = await downloadContent({
         url: `https://${platformToolsHost}/android/repository/platform-tools-latest-${os}.zip`,
         destinationPath: archivePath,
         policy: { allowedHosts: [platformToolsHost] }
      });
      if (Result.isError(downloaded)) {
         return Result.err<string, Problem>(
            createProblem('android.adb.download-failed', { cause: downloaded.error.detail ?? downloaded.error.message })
         );
      }

      const extracted = await extractAdb(archivePath, platform, options.dataPath);
      await removeQuietly(archivePath);
      if (Result.isError(extracted)) return extracted;

      if (!(await works(managedPath))) {
         return Result.err<string, Problem>(createProblem('android.adb.unusable'));
      }

      return Result.ok<string, Problem>(managedPath);
   }

   return { resolve };
}

async function extractAdb(archivePath: string, platform: NodeJS.Platform, dataPath: string): Promise<Result<string, Problem>> {
   const needed =
      platform === 'win32' ? ['platform-tools/adb.exe', 'platform-tools/AdbWinApi.dll', 'platform-tools/AdbWinUsbApi.dll'] : ['platform-tools/adb'];

   const archive = await openZipArchive(archivePath, { maxEntries: maxPlatformToolsEntries });
   if (Result.isError(archive)) {
      return Result.err<string, Problem>(createProblem('android.adb.extract-failed', { cause: archive.error.message }));
   }

   try {
      const prepared = await Result.tryPromise({
         try: () => mkdir(join(dataPath, 'platform-tools'), { recursive: true }),
         catch: (cause) => createProblem('android.adb.extract-failed', { cause })
      });
      if (Result.isError(prepared)) return Result.err(prepared.error);

      for (const name of needed) {
         const record = archive.value.records.find(
            (candidate) =>
               candidate.name === name &&
               !candidate.encrypted &&
               (candidate.compressionMethod === zipCompressionStored || candidate.compressionMethod === zipCompressionDeflate)
         );
         if (!record) {
            return Result.err<string, Problem>(createProblem('android.adb.extract-failed', { cause: `${name} is missing` }));
         }

         const stream = await archive.value.openEntryStream(record);
         if (Result.isError(stream)) {
            return Result.err<string, Problem>(createProblem('android.adb.extract-failed', { cause: `${name}: ${stream.error.message}` }));
         }

         const targetPath = join(dataPath, 'platform-tools', name.split('/').pop() ?? name);
         const written = await Result.tryPromise({
            try: () => pipeline(stream.value, createWriteStream(targetPath)),
            catch: (cause) => createProblem('android.adb.extract-failed', { cause: `${name}: ${causeMessage(cause)}` })
         });
         if (Result.isError(written)) return Result.err<string, Problem>(written.error);

         if (platform !== 'win32') {
            const executable = await Result.tryPromise({
               try: () => chmod(targetPath, 0o755),
               catch: (cause) => createProblem('android.adb.extract-failed', { cause })
            });
            if (Result.isError(executable)) return Result.err(executable.error);
         }
      }
   } finally {
      archive.value.close();
   }

   return Result.ok<string, Problem>(join(dataPath, 'platform-tools', platform === 'win32' ? 'adb.exe' : 'adb'));
}

async function findOnPath(name: string) {
   for (const directory of (process.env.PATH ?? '').split(delimiter)) {
      if (!isAbsolute(directory)) continue;
      const candidate = join(directory, name);
      if (Result.isOk(await Result.tryPromise(() => access(candidate, constants.X_OK)))) return candidate;
   }
   return null;
}
