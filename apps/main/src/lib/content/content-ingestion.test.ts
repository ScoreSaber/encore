import { Result } from 'better-result';
import { expect, onTestFinished, test } from 'vite-plus/test';

import { createContentIngestionService } from '@/lib/content/content-ingestion';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function stagedFileName(url: string) {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-ingest-'));
   const service = createContentIngestionService({ dataPath, fetchContent: () => Promise.resolve(new Response('model')) });
   onTestFinished(() => rm(dataPath, { recursive: true, force: true }));

   const staged = await service.ingestFile({ source: { kind: 'url', url } });
   if (Result.isError(staged)) throw new Error(staged.error.code);
   await staged.value.dispose();

   return staged.value.fileName;
}

test('keeps the extension when a long downloaded file name is truncated', async () => {
   const fileName = await stagedFileName(`https://example.com/${'a'.repeat(150)}.saber`);

   expect(fileName).toBe(`${'a'.repeat(120)}.saber`);
});

test('names a download whose URL has a malformed percent escape', async () => {
   expect(await stagedFileName('https://example.com/Cool%ZZ.saber')).toBe('Cool%ZZ.saber');
});
