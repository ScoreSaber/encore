import { Result } from 'better-result';

import { bsipaLoaderName, bsipaPatcherName } from '@/modules/mods/main/mod-paths';
import type { OperationError } from '@/modules/operations/contract';

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

const beatSaberExecutableName = 'Beat Saber.exe';
const patcherTimeoutMs = 60_000;

export type ModPatcherRun = (input: { executablePath: string; args: string[]; cwd: string }) => Promise<Result<void, OperationError>>;

export type ModPatcherOptions = {
   platform?: NodeJS.Platform;
   run?: ModPatcherRun;
};

export type ModPatcher = ReturnType<typeof createModPatcher>;

export function createModPatcher(options: ModPatcherOptions = {}) {
   const platform = options.platform ?? process.platform;
   const run = options.run ?? runPatcher;
   const supported = platform === 'win32';

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

   async function execute(installPath: string, args: string[]): Promise<Result<void, OperationError>> {
      if (!supported) {
         return Result.err<void, OperationError>({
            code: 'mods.patcher.unsupported-platform',
            message: 'the BSIPA patcher only runs on Windows'
         });
      }

      const executablePath = join(installPath, bsipaPatcherName);
      const gamePath = join(installPath, beatSaberExecutableName);
      if (!(await fileExists(executablePath)) || !(await fileExists(gamePath))) {
         return Result.err<void, OperationError>({
            code: 'mods.patcher.missing',
            message: 'the BSIPA patcher is not in the install folder'
         });
      }

      return run({ executablePath, args: [gamePath, ...args], cwd: installPath });
   }

   return { supported, isPatched, hasPatcher, patch, revert };
}

function runPatcher(input: { executablePath: string; args: string[]; cwd: string }) {
   return new Promise<Result<void, OperationError>>((resolve) => {
      execFile(input.executablePath, input.args, { cwd: input.cwd, timeout: patcherTimeoutMs, windowsHide: true }, (error) => {
         resolve(
            error
               ? Result.err<void, OperationError>({
                    code: 'mods.patcher.failed',
                    message: 'the BSIPA patcher did not finish',
                    details: { detail: error.message }
                 })
               : Result.ok<void, OperationError>(undefined)
         );
      });
   });
}

async function fileExists(path: string) {
   const read = await Result.tryPromise({ try: () => access(path), catch: () => null });

   return Result.isOk(read);
}
