import { Result } from 'better-result';
import { expect, test } from 'vite-plus/test';

import { createInstallTestbed, writeInstallFolder } from '@/modules/installs/main/install-registry.fixture';

import { execFileSync } from 'node:child_process';
import { constants, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

test('leaves an unreadable install list untouched instead of replacing it with detected installs', async () => {
   const { dataPath, registry, setCandidates } = await createInstallTestbed();
   const registryPath = join(dataPath, 'installs.json');
   const original = JSON.stringify({ schemaVersion: 1, installs: [{ id: 'library-original', unexpected: true }] });
   await writeFile(registryPath, original, 'utf8');
   setCandidates([{ store: 'steam', path: join(dataPath, 'steam', 'Beat Saber'), libraryPath: join(dataPath, 'steam'), appId: '620980' }]);

   expect(await registry.list()).toMatchObject({ installs: [], problems: [{ code: 'installs.registry.read-failed', path: registryPath }] });
   expect(Result.isError(await registry.register({ source: 'library', path: join(dataPath, 'library', 'Beat Saber') }))).toBe(true);
   expect(await readFile(registryPath, 'utf8')).toBe(original);
});

test.skipIf(process.platform === 'win32')('shows an install registered while an older scan is still reading', async () => {
   const { dataPath, installRoot, registry } = await createInstallTestbed();
   const pausedPath = join(installRoot, 'Paused');
   const versionPipe = join(pausedPath, 'Beat Saber_Data', 'globalgamemanagers');
   await mkdir(join(pausedPath, 'Beat Saber_Data'), { recursive: true });
   execFileSync('mkfifo', [versionPipe]);
   const now = new Date().toISOString();
   const paused = {
      id: 'paused',
      targetId: 'local',
      source: 'library',
      name: null,
      pinned: false,
      color: null,
      store: null,
      path: pausedPath,
      aliases: [],
      createdAt: now,
      updatedAt: now
   };
   await writeFile(join(dataPath, 'installs.json'), JSON.stringify({ schemaVersion: 1, installs: [paused] }), 'utf8');
   const installPath = await writeInstallFolder(join(installRoot, 'Beat Saber'));

   const olderScan = registry.list();
   await sleep(0);
   let settled = false;
   const registering = registry.register({ source: 'library', path: installPath }).finally(() => {
      settled = true;
   });
   while (!(await readFile(join(dataPath, 'installs.json'), 'utf8')).includes(installPath)) await sleep(5);
   await sleep(50);

   while (!settled) await (await openPipeWriter(versionPipe))?.close();
   await olderScan;

   expect(Result.isOk(await registering)).toBe(true);
   expect((await registry.list()).installs).toContainEqual(expect.objectContaining({ path: installPath, status: 'ready' }));
});

async function openPipeWriter(pipePath: string) {
   const opened = await Result.tryPromise(() => open(pipePath, constants.O_WRONLY | constants.O_NONBLOCK));
   if (Result.isOk(opened)) return opened.value;
   await sleep(5);
   return null;
}
