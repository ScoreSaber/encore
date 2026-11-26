import { Result } from 'better-result';

import { requireThirtyTwoBit } from '@/lib/dotnet/clr-header';
import { createProblem, type Problem } from '@/lib/errors';
import { beatSaberExecutablePath } from '@/modules/installs/main/beat-saber-files';
import type { ProtonLaunchPlan } from '@/modules/launch/contract';
import { buildProtonCommand, buildProtonEnv } from '@/modules/launch/main/launch-options';
import { bsipaLoaderName, bsipaPatcherName } from '@/modules/mods/main/mod-paths';

import { execFile } from 'node:child_process';
import { access, copyFile, open, rm } from 'node:fs/promises';
import { join } from 'node:path';

const patcherTimeoutMs = 60_000;
const protonPatcherTimeoutMs = 10 * 60_000;
const thirtyTwoBitPatcherName = 'IPA.x86.exe';

type ModPatcherRun = (input: {
   executablePath: string;
   args: string[];
   cwd: string;
   env?: Record<string, string>;
   timeoutMs: number;
}) => Promise<Result<void, Problem>>;

type ModPatcherOptions = {
   platform?: NodeJS.Platform;
   arch?: string;
   run?: ModPatcherRun;
   proton?: () => Promise<Result<ProtonLaunchPlan, Problem>>;
};

export type ModPatcher = ReturnType<typeof createModPatcher>;

export function createModPatcher(options: ModPatcherOptions = {}) {
   const platform = options.platform ?? process.platform;
   const arch = options.arch ?? process.arch;
   const run = options.run ?? runPatcher;
   const proton = platform === 'linux' ? options.proton : undefined;
   const supported = platform === 'win32' || proton !== undefined;

   async function canPatch() {
      if (platform === 'win32') return true;
      return proton ? Result.isOk(await proton()) : false;
   }

   async function isPatched(installPath: string) {
      return fileExists(join(installPath, bsipaLoaderName));
   }

   async function hasPatcher(installPath: string) {
      return fileExists(join(installPath, bsipaPatcherName));
   }

   async function patch(installPath: string) {
      return execute(installPath, ['-n']);
   }

   async function revert(installPath: string) {
      return execute(installPath, ['--revert', '-n']);
   }

   async function execute(installPath: string, args: string[]): Promise<Result<void, Problem>> {
      if (!supported) {
         return Result.err<void, Problem>(createProblem('mods.patcher.unsupported-platform'));
      }

      const executablePath = join(installPath, bsipaPatcherName);
      const gamePath = beatSaberExecutablePath(installPath);
      if (!(await fileExists(executablePath)) || !(await fileExists(gamePath))) {
         return Result.err<void, Problem>(createProblem('mods.patcher.missing'));
      }

      if (!proton) return run({ executablePath, args: [gamePath, ...args], cwd: installPath, timeoutMs: patcherTimeoutMs });

      return Result.gen(async function* () {
         const plan = yield* Result.await(proton());
         const env = buildProtonEnv(plan, installPath);
         const inProton = (verb: 'runinprefix' | 'getcompatpath', target: string, targetArgs: string[]) => {
            const command = buildProtonCommand({ proton: plan, verb, executablePath: target, args: targetArgs, workingDirectory: installPath, env });
            return run({ executablePath: command.executablePath, args: [...command.args], cwd: installPath, env, timeoutMs: protonPatcherTimeoutMs });
         };

         if (!(await fileExists(join(plan.compatDataPath, 'pfx')))) yield* Result.await(inProton('getcompatpath', installPath, []));
         const patcherPath = arch === 'arm64' ? yield* Result.await(thirtyTwoBitCopy(installPath, executablePath)) : executablePath;
         const ran = await inProton('runinprefix', patcherPath, [gamePath, ...args]);
         if (patcherPath !== executablePath) await rm(patcherPath, { force: true });
         return ran;
      });
   }

   return { supported, canPatch, isPatched, hasPatcher, patch, revert };
}

async function thirtyTwoBitCopy(installPath: string, executablePath: string) {
   const copyPath = join(installPath, thirtyTwoBitPatcherName);
   return Result.tryPromise({
      try: async () => {
         await copyFile(executablePath, copyPath);
         const file = await open(copyPath, 'r+');
         try {
            await requireThirtyTwoBit(file);
         } finally {
            await file.close();
         }
         return copyPath;
      },
      catch: (cause) => createProblem('mods.patcher.failed', { cause })
   });
}

function runPatcher(input: { executablePath: string; args: string[]; cwd: string; env?: Record<string, string>; timeoutMs: number }) {
   return new Promise<Result<void, Problem>>((resolve) => {
      execFile(
         input.executablePath,
         input.args,
         { cwd: input.cwd, env: input.env ? { ...process.env, ...input.env } : undefined, timeout: input.timeoutMs, windowsHide: true },
         (error) => {
            resolve(error ? Result.err<void, Problem>(createProblem('mods.patcher.failed', { cause: error })) : Result.ok<void, Problem>(undefined));
         }
      );
   });
}

async function fileExists(path: string) {
   const read = await Result.tryPromise({ try: () => access(path), catch: () => null });

   return Result.isOk(read);
}
