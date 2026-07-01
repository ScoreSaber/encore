import { Result, TaggedError } from 'better-result';

import { execFileSync } from 'node:child_process';

const releaseChannel = 'alpha';
const commitHashLength = 6;

class GitRevisionError extends TaggedError('GitRevisionError')<{
   message: string;
   cwd: string;
   cause: unknown;
}>() {}

export type EncoreReleaseInfo = {
   channel: typeof releaseChannel;
   version: string;
   label: string;
   source: 'release' | 'commit' | 'fallback';
};

export function getEncoreReleaseInfo({ appVersion, isPackaged, cwd }: { appVersion: string; isPackaged: boolean; cwd: string }): EncoreReleaseInfo {
   if (isPackaged) {
      return createReleaseInfo(appVersion, 'release');
   }

   const revision = getGitRevision(cwd);
   if (Result.isOk(revision)) {
      return createReleaseInfo(revision.value, 'commit');
   }

   return createReleaseInfo(appVersion, 'fallback');
}

function createReleaseInfo(version: string, source: EncoreReleaseInfo['source']): EncoreReleaseInfo {
   return {
      channel: releaseChannel,
      version,
      label: `${releaseChannel}@${version}`,
      source
   };
}

function getGitRevision(cwd: string) {
   return Result.try({
      try: () =>
         execFileSync('git', ['rev-parse', `--short=${commitHashLength}`, 'HEAD'], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
         }).trim(),
      catch: (cause: unknown) =>
         new GitRevisionError({
            message: 'failed to resolve git revision',
            cwd,
            cause
         })
   });
}
