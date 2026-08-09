import { Result } from 'better-result';

import { downloadContent, type ContentFetch } from '@/lib/content/content-download';

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('bounded content download', () => {
   test('checks the initial address and every redirect against the same policy', async () => {
      const root = await createTempRoot();
      let requests = 0;

      const plaintext = await downloadContent({
         url: 'http://cdn.example.com/source.zip',
         destinationPath: join(root, 'plaintext.zip'),
         fetchContent: () => {
            requests += 1;
            return Promise.resolve(new Response('zip'));
         }
      });
      const redirected = await downloadContent({
         url: 'https://cdn.example.com/source.zip',
         destinationPath: join(root, 'redirected.zip'),
         fetchContent: () => Promise.resolve(redirectResponse('http://cdn.example.com/source.zip'))
      });
      const looping = await downloadContent({
         url: 'https://cdn.example.com/source.zip',
         destinationPath: join(root, 'looping.zip'),
         limits: { maxRedirects: 2 },
         fetchContent: () => Promise.resolve(redirectResponse('https://cdn.example.com/again.zip'))
      });

      expect(Result.isError(plaintext) && plaintext.error.code).toBe('content.source.unsupported-scheme');
      expect(Result.isError(redirected) && redirected.error.code).toBe('content.source.unsupported-scheme');
      expect(Result.isError(looping) && looping.error.code).toBe('content.download.too-many-redirects');
      expect(requests).toBe(0);
   });

   test('enforces declared and streamed size limits without leaving staged files', async () => {
      const root = await createTempRoot();
      const declaredPath = join(root, 'declared.zip');
      const streamedPath = join(root, 'streamed.zip');
      const declared = await downloadContent({
         url: 'https://cdn.example.com/source.zip',
         destinationPath: declaredPath,
         limits: { maxDownloadBytes: 4 },
         fetchContent: streamingFetch(['beatsaber'], { headers: { 'content-length': '9' } })
      });
      const streamed = await downloadContent({
         url: 'https://cdn.example.com/source.zip',
         destinationPath: streamedPath,
         limits: { maxDownloadBytes: 4 },
         fetchContent: streamingFetch(['beat', 'saber'])
      });

      expect(Result.isError(declared) && declared.error.code).toBe('content.download.too-large');
      expect(Result.isError(streamed) && streamed.error.code).toBe('content.download.too-large');
      expect(await pathMissing(declaredPath)).toBe(true);
      expect(await pathMissing(streamedPath)).toBe(true);
   });
});

function streamingFetch(chunks: readonly string[], init: { headers?: Record<string, string> } = {}): ContentFetch {
   return () => {
      const encoder = new TextEncoder();
      let index = 0;

      const body = new ReadableStream<Uint8Array>({
         pull(controller) {
            const chunk = chunks[index];
            index += 1;

            if (chunk === undefined) {
               controller.close();
               return;
            }

            controller.enqueue(encoder.encode(chunk));
         }
      });

      return Promise.resolve(new Response(body, { headers: init.headers }));
   };
}

function redirectResponse(location: string) {
   return new Response(null, { status: 302, headers: { location } });
}

async function pathMissing(targetPath: string) {
   return readFile(targetPath).then(
      () => false,
      () => true
   );
}

async function createTempRoot() {
   const root = await mkdtemp(join(tmpdir(), 'encore-download-'));
   tempRoots.push(root);

   return root;
}
