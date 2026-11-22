import { expect, onTestFinished, test } from 'vite-plus/test';

import { createSupportLogService, textLogFileName } from '@/modules/support/main/support-logs';

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('reads only log files inside the logs folder and redacts secrets as they are read', async () => {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-support-'));
   onTestFinished(() => rm(dataPath, { recursive: true, force: true }));
   const homePath = join(dataPath, 'home');
   const logsPath = join(dataPath, 'logs');
   await mkdir(logsPath, { recursive: true });
   await writeFile(join(dataPath, 'secret.txt'), 'password=hunter2hunter2\n', 'utf8');
   await symlink(join(dataPath, 'secret.txt'), join(logsPath, 'linked.log'));
   await writeFile(
      join(logsPath, 'encore.log'),
      [
         'Authorization: Bearer abcdefghijklmnop.qrstuvwxyz',
         'refresh_token: "5f1a0c8e9d4b7a2f"',
         `loaded C:\\Users\\Jacob\\AppData\\Roaming\\Encore and ${homePath}/Games`,
         'signed in as player@example.com with 76561198000000000'
      ].join('\n'),
      'utf8'
   );
   const service = createSupportLogService({
      logsPath,
      homePath,
      registry: { get: () => Promise.resolve(null), list: () => Promise.resolve({ installs: [] }) }
   });

   for (const fileId of ['../secret.txt', join(dataPath, 'secret.txt'), 'linked.log']) {
      expect(await service.readLog({ source: 'app', fileId })).toMatchObject({ status: 'unavailable', issue: 'invalid-path' });
   }

   const excerpt = await service.readLog({ source: 'app', fileId: 'encore.log' });
   if (excerpt.status !== 'ready') throw new Error('the log was not readable');

   expect(excerpt.text).toContain('C:\\Users\\[user]\\AppData');
   expect(excerpt.text).toContain('~/Games');
   for (const secret of ['abcdefghijklmnop', '5f1a0c8e9d4b7a2f', 'Jacob', 'player@example.com', '76561198000000000']) {
      expect(excerpt.text).not.toContain(secret);
   }
});

test('names receiver log copies as plain text files whatever the receiver calls them', () => {
   expect(['run.cmd', '..\\..\\Startup\\evil.bat', 'Beat Saber.LOG', 'notes.txt:payload.exe', 'trailing.log. ', '/'].map(textLogFileName)).toEqual([
      'run.cmd.log',
      'evil.bat.log',
      'Beat Saber.LOG',
      'notes.txt payload.exe.log',
      'trailing.log',
      'encore.log'
   ]);
});
