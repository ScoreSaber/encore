import { Result } from 'better-result';

import { createAdbClient, type AdbClient } from '@/lib/android/adb';
import type { Problem } from '@/lib/errors';
import { beatSaberPackageId } from '@/modules/quest/contract';
import { createQuestDeviceService, type QuestConnection, type QuestDeviceService } from '@/modules/quest/main/quest-device-service';
import { createQuestMutationLock } from '@/modules/quest/main/quest-mutation-lock';

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const fakeQuestApkPath = `/data/app/${beatSaberPackageId}-1/base.apk`;

export function createFakeQuestFs(input: { apk?: Buffer } = {}) {
   const files = new Map<string, Buffer>();
   const dirs = new Set<string>();

   if (input.apk) files.set(fakeQuestApkPath, input.apk);

   const ok = <Value>(value: Value) => Result.ok<Value, Problem>(value);

   function under(prefix: string) {
      return [...files.keys()].filter((path) => path.startsWith(`${prefix}/`));
   }

   function childNames(directory: string) {
      return [
         ...new Set(
            [...under(directory), ...[...dirs].filter((path) => path.startsWith(`${directory}/`))]
               .map((path) => path.slice(directory.length + 1).split('/')[0])
               .filter((name): name is string => Boolean(name))
         )
      ];
   }

   function removeUnder(prefix: string) {
      for (const path of files.keys()) {
         if (path === prefix || path.startsWith(`${prefix}/`)) files.delete(path);
      }
      for (const path of dirs) {
         if (path === prefix || path.startsWith(`${prefix}/`)) dirs.delete(path);
      }
   }

   function isDirectory(path: string) {
      return dirs.has(path) || under(path).length > 0;
   }

   const client: AdbClient = {
      ...createAdbClient({ adbPath: 'adb', exec: async () => ok({ stdout: '', stderr: '' }) }),
      push: async (_serial, localPath, remotePath) => {
         files.set(remotePath, await readFile(localPath));
         return ok(undefined);
      },
      pull: async (_serial, remotePath, localPath) => {
         const contents = files.get(remotePath);
         if (!contents) return Result.err<void, Problem>({ code: 'android.adb.failed', message: `no such file ${remotePath}` });

         await mkdir(dirname(localPath), { recursive: true });
         await writeFile(localPath, contents);
         return ok(undefined);
      },
      mkdirs: async (_serial, remotePath) => {
         dirs.add(remotePath);
         return ok(undefined);
      },
      removePath: async (_serial, remotePath) => {
         removeUnder(remotePath);
         return ok(undefined);
      },
      removeFile: async (_serial, remotePath) => {
         files.delete(remotePath);
         return ok(undefined);
      },
      listFiles: async (_serial, remoteDirectory) => ok(childNames(remoteDirectory)),
      listModified: async (_serial, remoteDirectory) => ok(childNames(remoteDirectory).map((name) => ({ name, modifiedAt: 1_000 }))),
      modifiedAt: async () => ok(1_000),
      fileExists: async (_serial, remotePath) => ok(files.has(remotePath) || dirs.has(remotePath) || under(remotePath).length > 0),
      readTextFile: async (_serial, remotePath) => {
         const found = files.get(remotePath);
         return found ? ok(found.toString('utf8')) : Result.err<string, Problem>({ code: 'android.adb.failed', message: 'no such file' });
      },
      sdkVersion: async () => ok(32),
      packageApkPath: async () => ok(files.has(fakeQuestApkPath) ? fakeQuestApkPath : null),
      copyPath: async (_serial, from, to) => {
         const contents = from.endsWith('/.');
         const source = contents ? from.slice(0, -2) : from;
         const file = files.get(source);
         const destination = !contents && isDirectory(to) ? `${to}/${source.slice(source.lastIndexOf('/') + 1)}` : to;

         if (file) {
            files.set(destination, file);
            return ok(undefined);
         }

         if (!isDirectory(source)) return Result.err<void, Problem>({ code: 'android.adb.failed', message: `no such file ${source}` });

         for (const path of under(source)) {
            const contents = files.get(path);
            if (contents) files.set(`${destination}/${path.slice(source.length + 1)}`, contents);
         }
         return ok(undefined);
      },
      overwriteFile: async (_serial, from, to) => {
         const contents = files.get(from);
         if (!contents || !files.has(to)) return Result.err<void, Problem>({ code: 'android.adb.failed', message: `cannot overwrite ${to}` });
         files.set(to, contents);
         return ok(undefined);
      },
      fileOwner: async () => ok('10123'),
      sha1Files: async (_serial, remotePaths) =>
         ok(
            createHash('sha1')
               .update(Buffer.concat(remotePaths.map((path) => files.get(path) ?? Buffer.alloc(0))))
               .digest('hex')
         ),
      movePath: async (_serial, from, to) => {
         const exists = (path: string) => files.has(path) || isDirectory(path);
         if (!exists(from) || exists(to)) return Result.err<void, Problem>({ code: 'android.adb.failed', message: `cannot move ${from}` });
         for (const path of [...files.keys()].filter((path) => path === from || path.startsWith(`${from}/`))) {
            files.set(`${to}${path.slice(from.length)}`, files.get(path) ?? Buffer.alloc(0));
            files.delete(path);
         }
         for (const path of [...dirs].filter((path) => path === from || path.startsWith(`${from}/`))) {
            dirs.add(`${to}${path.slice(from.length)}`);
            dirs.delete(path);
         }
         return ok(undefined);
      },
      uninstallPackage: async () => {
         files.delete(fakeQuestApkPath);
         removeUnder(`/sdcard/Android/obb/${beatSaberPackageId}`);
         removeUnder(`/sdcard/Android/data/${beatSaberPackageId}`);
         return ok(undefined);
      },
      installApk: async (_serial, localPath) => {
         files.set(fakeQuestApkPath, await readFile(localPath));
         return ok(undefined);
      }
   };

   return { client, files, dirs };
}

export function createFakeQuestDevices(
   client: AdbClient,
   input: { gameVersion?: string | null; modloaderInstalled?: boolean } = {}
): QuestDeviceService {
   const gameVersion = input.gameVersion === undefined ? '1.40.0' : input.gameVersion;
   const modloaderInstalled = input.modloaderInstalled ?? true;

   return {
      ...createQuestDeviceService({
         provisioner: { resolve: async () => Result.ok('adb') },
         createClient: () => client,
         mutations: createQuestMutationLock()
      }),
      getConnection: () => Result.ok<QuestConnection, Problem>({ client, serial: 'Q1SERIAL', gameVersion, modloaderInstalled })
   };
}
