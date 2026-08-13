import { afterEach, describe, expect, test } from 'vite-plus/test';

import { createSupportLogService } from '@/modules/support/main/support-logs';

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) {
      await cleanup();
   }
   cleanups.length = 0;
});

describe('support logs', () => {
   test('lists app and install logs and refuses anything that is not a real file in the folder', async () => {
      const harness = await createHarness();
      await writeFile(join(harness.logsPath, 'encore-2026-07-27.log'), 'old\n', 'utf8');
      await writeFile(join(harness.logsPath, 'encore-2026-07-28.log'), 'new\n', 'utf8');
      await writeFile(join(harness.logsPath, 'notes.md'), 'ignored\n', 'utf8');
      await symlink(join(harness.dataPath, 'secret.txt'), join(harness.logsPath, 'linked.log'));
      await writeFile(join(harness.dataPath, 'secret.txt'), 'password=hunter2hunter2\n', 'utf8');
      await writeFile(join(harness.installLogsPath, '_latest.log'), 'crash\n', 'utf8');

      const app = await harness.service.listAppLogs();
      const install = await harness.service.listInstallLogs();
      const escaped = await harness.service.readLog({ source: 'app', fileId: '../secret.txt' });
      const absolute = await harness.service.readLog({ source: 'app', fileId: join(harness.dataPath, 'secret.txt') });
      const linked = await harness.service.readLog({ source: 'app', fileId: 'linked.log' });

      expect(app.status).toBe('ready');
      expect(app.files.map((file) => file.id)).toEqual(['encore-2026-07-28.log', 'encore-2026-07-27.log']);
      expect(install).toMatchObject({ source: 'install', status: 'ready' });
      expect(install.files).toHaveLength(1);
      expect(install.files[0]?.id).toBe('_latest.log');
      expect(install.files[0]?.installId).toBe('install_1');
      expect(install.files[0]?.installName).toBe('1.29.1');
      expect(escaped).toMatchObject({ status: 'unavailable', issue: 'invalid-path' });
      expect(absolute).toMatchObject({ status: 'unavailable', issue: 'invalid-path' });
      expect(linked).toMatchObject({ status: 'unavailable', issue: 'invalid-path' });
   });

   test('reads a full redacted log and says why a log is unavailable', async () => {
      const harness = await createHarness();
      const filler = 'x'.repeat(1024);
      await writeFile(
         join(harness.installLogsPath, '_latest.log'),
         `first line\n${filler}\ntoken=jkq82hfkalsm2xt9 in ${harness.homePath}/Games\n`,
         'utf8'
      );

      const excerpt = await harness.service.readLog({ source: 'install', installId: 'install_1', fileId: '_latest.log' });
      const missingFile = await harness.service.readLog({ source: 'install', installId: 'install_1', fileId: 'gone.log' });
      const missingInstall = await harness.service.readLog({ source: 'install', installId: 'install_unknown', fileId: '_latest.log' });

      expect(excerpt).toMatchObject({ status: 'ready' });
      expect(excerpt.status === 'ready' && excerpt.text).toContain('token=[redacted] in ~/Games');
      expect(excerpt.status === 'ready' && excerpt.text).toContain('first line');
      expect(missingFile).toMatchObject({ status: 'unavailable', issue: 'not-found' });
      expect(missingInstall).toMatchObject({ status: 'unavailable', issue: 'not-found', detail: 'install-not-found' });
   });
});

async function createHarness() {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-support-'));
   const homePath = join(dataPath, 'home');
   const logsPath = join(dataPath, 'logs');
   const installPath = join(homePath, 'Beat Saber');
   const installLogsPath = join(installPath, 'Logs');
   await mkdir(logsPath, { recursive: true });
   await mkdir(installLogsPath, { recursive: true });

   cleanups.push(() => rm(dataPath, { recursive: true, force: true }));

   return {
      dataPath,
      homePath,
      logsPath,
      installLogsPath,
      service: createSupportLogService({
         logsPath,
         homePath,
         getInstall: (installId) => Promise.resolve(installId === 'install_1' ? { path: installPath } : null),
         getInstalls: () => Promise.resolve([{ id: 'install_1', name: '1.29.1', path: installPath }])
      })
   };
}
