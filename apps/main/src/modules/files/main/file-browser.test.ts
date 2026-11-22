import { expect, onTestFinished, test } from 'vite-plus/test';

import { createFileBrowser } from '@/modules/files/main/file-browser';

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('lists folders before files and steps up through the parent', async () => {
   const root = await mkdtemp(join(tmpdir(), 'encore-files-'));
   onTestFinished(() => rm(root, { recursive: true, force: true }));
   await mkdir(join(root, 'Beat Saber 10'));
   await mkdir(join(root, 'Beat Saber 9'));
   await writeFile(join(root, 'a.txt'), '');
   const browser = createFileBrowser({ platform: 'linux', home: root });

   expect(await browser.list({ path: null })).toMatchObject({
      status: 'ok',
      path: root,
      entries: [
         { name: 'Beat Saber 9', kind: 'directory' },
         { name: 'Beat Saber 10', kind: 'directory' },
         { name: 'a.txt', kind: 'file' }
      ]
   });
   expect(await browser.list({ path: join(root, 'Beat Saber 9') })).toMatchObject({ parent: root, entries: [] });
   expect(await browser.list({ path: join(root, 'missing') })).toMatchObject({ status: 'unreadable', parent: root });
});
