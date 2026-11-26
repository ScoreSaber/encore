import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import { ensureArm64Assets, type Arm64Assets } from '@/modules/arm64/main/arm64-assets';
import { enterNative, leaveNative, undoOtherToolConversion, type Placement } from '@/modules/arm64/main/arm64-install';
import { arm64Pins } from '@/modules/arm64/main/arm64-pins';
import { beatSaberExecutablePath, isArm64Image, readUnityVersion } from '@/modules/installs/main/beat-saber-files';
import type { LaunchEnvironment } from '@/modules/launch/contract';
import type { OperationProgress } from '@/modules/operations/contract';

import { mkdir, readdir, readFile, rm, symlink } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';

const anyImage = /^MZ/;

export type PrepareArm64 = ReturnType<typeof createArm64Launch>;

type PrepareInput = {
   installPath: string;
   protonBinaryPath: string;
   preferNative: boolean;
   signal: AbortSignal;
   onProgress: (progress: OperationProgress) => void;
};

export function createArm64Launch({ cacheRoot }: { cacheRoot: string }) {
   return function prepare(input: PrepareInput): Promise<Result<LaunchEnvironment | null, Problem>> {
      const { installPath, protonBinaryPath } = input;

      return Result.gen(async function* () {
         yield* Result.await(undoOtherToolConversion(installPath));

         const supported = input.preferNative && (await readUnityVersion(installPath)) === arm64Pins.unityVersion;
         const proton = supported ? await readProtonVersion(protonBinaryPath) : null;
         const assets = proton
            ? yield* Result.await(ensureArm64Assets(proton, { cacheRoot, signal: input.signal, onProgress: input.onProgress }))
            : null;

         if (!assets) {
            yield* Result.await(leaveNative(installPath));
            if (await isArm64Image(beatSaberExecutablePath(installPath))) return Result.err(createProblem('arm64.restore-failed'));
            return Result.ok(null);
         }

         const wine = join(assets.runtime, 'wine');
         const placements = yield* Result.await(
            Result.tryPromise({
               try: async () => {
                  await linkUnixLibraries(wine, protonBinaryPath);
                  return listPlacements(assets);
               },
               catch: (cause) => createProblem('arm64.install-failed', { cause })
            })
         );
         yield* Result.await(enterNative(installPath, `${basename(assets.unity)}+${basename(assets.runtime)}`, placements));

         return Result.ok({ WINEDLLPATH: wine, ARMONICA_RUNTIME: `Z:${wine.replaceAll('/', '\\')}` });
      });
   };
}

async function readProtonVersion(protonBinaryPath: string) {
   const version = await Result.tryPromise(() => readFile(join(dirname(protonBinaryPath), 'version'), 'utf8'));
   return Result.isOk(version) ? (/\sproton-([\w.-]+)-arm64\s*$/.exec(version.value)?.[1] ?? null) : null;
}

async function linkUnixLibraries(wine: string, protonBinaryPath: string) {
   const protonLibraries = join(dirname(protonBinaryPath), 'files', 'lib', 'wine', 'aarch64-unix');
   await mkdir(join(wine, 'aarch64-unix'), { recursive: true });

   for (const dll of await readdir(join(wine, 'aarch64-windows'))) {
      const name = basename(dll, '.dll');
      const link = join(wine, 'aarch64-unix', `${name}.so`);
      await rm(link, { force: true });
      await symlink(join(protonLibraries, `${name.replace(/_a64$/, '')}.so`), link);
   }
}

async function listPlacements({ unity, runtime }: Arm64Assets): Promise<Placement[]> {
   const mods = await listFiles(join(runtime, 'mods'));
   return [
      ...(await listFiles(unity)),
      ...(await listFiles(join(runtime, 'game'))),
      ...mods.map((file) => ({ ...file, replaces: arm64Pins.armonica.replaces.get(file.target) ?? anyImage }))
   ];
}

async function listFiles(root: string) {
   const entries = await readdir(root, { recursive: true, withFileTypes: true });
   return entries
      .filter((entry) => entry.isFile())
      .map((entry) => {
         const source = join(entry.parentPath, entry.name);
         return { target: relative(root, source), source };
      });
}
