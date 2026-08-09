import { Result } from 'better-result';

import type { EncoreReleaseInfo } from '@/modules/app/contract';

import { execFileSync } from 'node:child_process';

const releaseChannel = 'alpha';
const commitHashLength = 6;

export function getEncoreReleaseInfo({ appVersion, isPackaged, cwd }: { appVersion: string; isPackaged: boolean; cwd: string }): EncoreReleaseInfo {
   let version = appVersion;
   let source: EncoreReleaseInfo['source'] = 'release';

   if (!isPackaged) {
      const revision = Result.try({
         try: () =>
            execFileSync('git', ['rev-parse', `--short=${commitHashLength}`, 'HEAD'], {
               cwd,
               encoding: 'utf8',
               stdio: ['ignore', 'pipe', 'ignore']
            }).trim(),
         catch: (cause) => cause
      });

      if (Result.isOk(revision)) {
         version = revision.value;
         source = 'commit';
      } else {
         source = 'fallback';
      }
   }

   return {
      channel: releaseChannel,
      version,
      label: `${releaseChannel}@${version}`,
      source
   };
}
