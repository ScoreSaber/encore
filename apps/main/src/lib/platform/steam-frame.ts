import { Result } from 'better-result';

import { readFileSync } from 'node:fs';

let detected: boolean | null = null;

export function isSteamFrame() {
   detected ??= process.platform === 'linux' && osRelease().get('ID') === 'steamos' && osRelease().get('VARIANT_ID') === 'vr';
   return detected;
}

function osRelease() {
   for (const path of ['/run/host/os-release', '/etc/os-release']) {
      const read = Result.try(() => readFileSync(path, 'utf8'));
      if (Result.isOk(read)) {
         return new Map(
            read.value.split('\n').flatMap((line): [string, string][] => {
               const separator = line.indexOf('=');
               if (separator <= 0) return [];
               const value = line.slice(separator + 1).trim();
               return [[line.slice(0, separator).trim(), value.replace(/^"(.*)"$/, '$1')]];
            })
         );
      }
   }
   return new Map<string, string>();
}
