import { afterEach, describe, expect, test } from 'vite-plus/test';

import { defineApiHandlers, type TargetDispatcher } from '@/lib/api';
import { supportApi } from '@/modules/support/api';
import { createSupportLogService } from '@/modules/support/main/support-logs';
import { createSupportService } from '@/modules/support/main/support-service';

import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) await cleanup();
   cleanups.length = 0;
});

describe('support diagnostics', () => {
   test('inlines the three newest Beat Saber logs across installs as Markdown', async () => {
      const dataPath = await mkdtemp(join(tmpdir(), 'encore-support-diagnostics-'));
      const firstInstallPath = join(dataPath, 'Beat Saber 1');
      const secondInstallPath = join(dataPath, 'Beat Saber 2');
      const firstInstallLogsPath = join(firstInstallPath, 'Logs');
      const secondInstallLogsPath = join(secondInstallPath, 'Logs');
      const appLogsPath = join(dataPath, 'encore-logs');
      await mkdir(firstInstallLogsPath, { recursive: true });
      await mkdir(secondInstallLogsPath, { recursive: true });
      await mkdir(appLogsPath, { recursive: true });
      cleanups.push(() => rm(dataPath, { recursive: true, force: true }));

      for (const [index, name] of ['old.log', 'third.log', 'second.log', 'latest.log'].entries()) {
         const path = join(index % 2 === 0 ? firstInstallLogsPath : secondInstallLogsPath, name);
         await writeFile(path, `${name} start\n\`\`\`\n${'x'.repeat(1024)}\n${name} end\n`, 'utf8');
         await utimes(path, index + 1, index + 1);
      }

      const logs = createSupportLogService({
         logsPath: appLogsPath,
         homePath: dataPath,
         getInstall: (installId) =>
            Promise.resolve(installId === 'first' ? { path: firstInstallPath } : installId === 'second' ? { path: secondInstallPath } : null),
         getInstalls: () =>
            Promise.resolve([
               { id: 'first', name: '1.29.1', path: firstInstallPath },
               { id: 'second', name: '1.40.0', path: secondInstallPath }
            ])
      });
      const callTarget: TargetDispatcher = async (local, method, targetId, input) => ({
         targetId,
         status: 'ok',
         value: await local.handlers[method](input)
      });
      const support = createSupportService({
         logs,
         installLogs: defineApiHandlers(supportApi, logs),
         callTarget,
         homePath: dataPath,
         getAppInfo: () => ({
            name: 'Encore',
            version: '1.2.3',
            release: { channel: 'alpha', version: '1.2.3', label: '1.2.3 alpha', source: 'release' },
            packaging: { packaged: false, format: 'development', selfUpdates: false, updateChecks: false, protocols: [], fileAssociations: [] },
            platform: 'linux',
            arch: 'x64',
            electron: '43.0.0',
            chrome: '142.0.0',
            node: '24.0.0'
         })
      });

      const bundle = await support.buildDiagnostics({ targetId: 'local' });

      expect(bundle.fileName.endsWith('.md')).toBe(true);
      expect(bundle.logs.map((log) => log.fileId)).toEqual(['1.40.0 / latest.log', '1.29.1 / second.log', '1.40.0 / third.log']);
      expect(bundle.text).toContain('# Encore diagnostics');
      expect(bundle.text).toContain('latest.log start');
      expect(bundle.text).toContain('latest.log end');
      expect(bundle.text).not.toContain('old.log start');
      expect(bundle.text).toContain('````text');
   });
});
