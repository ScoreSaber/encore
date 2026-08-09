import { Result } from 'better-result';

import { resolveHttpsUrl } from '@/lib/http/url';
import { modRepositoryProblem, type ModRepositoryProblem } from '@/modules/mods/contract';

const githubBlobPattern = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/;

export function repositoryUrlHost(input: string) {
   return URL.canParse(input) ? new URL(input).hostname.toLowerCase() : null;
}

export function resolveRepositoryListingUrl(input: string): Result<string, ModRepositoryProblem> {
   const trimmed = input.trim();
   const parsed = Result.try({
      try: () => new URL(trimmed),
      catch: (): ModRepositoryProblem => modRepositoryProblem('invalid-url', 'the address could not be read')
   });
   if (Result.isError(parsed)) return Result.err<string, ModRepositoryProblem>(parsed.error);

   if (parsed.value.protocol === 'file:') {
      if (parsed.value.hostname || parsed.value.username || parsed.value.password || parsed.value.port) {
         return Result.err<string, ModRepositoryProblem>(modRepositoryProblem('invalid-url', 'a local repository cannot name a host or credentials'));
      }

      parsed.value.hash = '';
      parsed.value.search = '';
      return Result.ok<string, ModRepositoryProblem>(withListingFile(parsed.value));
   }

   const resolved = resolveHttpsUrl(trimmed);
   if (Result.isError(resolved)) return Result.err<string, ModRepositoryProblem>(modRepositoryProblem('invalid-url', resolved.error.message));

   const url = resolved.value;
   if (url.port) return Result.err<string, ModRepositoryProblem>(modRepositoryProblem('invalid-url', 'the address cannot name a port'));

   url.hash = '';

   const blob = githubBlobPattern.exec(url.pathname);
   if (url.hostname.toLowerCase() === 'github.com' && blob) {
      const raw = new URL(`https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`);
      return Result.ok<string, ModRepositoryProblem>(withListingFile(raw));
   }

   return Result.ok<string, ModRepositoryProblem>(withListingFile(url));
}

function withListingFile(url: URL) {
   if (url.pathname.toLowerCase().endsWith('.json')) return url.toString();

   url.pathname = `${url.pathname.replace(/\/+$/, '')}/index.json`;

   return url.toString();
}
