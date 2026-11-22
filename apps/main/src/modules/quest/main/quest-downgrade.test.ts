import { Result } from 'better-result';
import { afterEach, describe, expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { createAdbClient, type AdbExec } from '@/lib/android/adb';
import { createQuestDowngrade } from '@/modules/quest/main/quest-downgrade';
import type { QuestVersionPlan } from '@/modules/quest/main/quest-version-catalog';

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const requestSchema = z.object({ type: z.string() });
const agentSha256 = 'ab'.repeat(32);
const plan: QuestVersionPlan = {
   installedVersion: '1.45.1_27839',
   version: '1.40.8_7379',
   downgrade: true,
   diffSequence: [
      {
         from_version: '1.45.1_27839',
         to_version: '1.40.8_7379',
         apk_diff: { diff_name: 'apk.diff', file_name: 'base.apk', file_crc: 1, output_file_name: 'base.apk', output_crc: 2, output_size: 3 },
         obb_diffs: []
      }
   ]
};
const dirs: string[] = [];
afterEach(async () => {
   await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('Quest native downgrade', () => {
   test('refuses an unverified agent and never submits Patch without a complete recovery backup', async () => {
      const tampered = await createHarness({ digest: '00'.repeat(32) });
      expect((await tampered.prepare()).match({ ok: () => '', err: (error) => error.code })).toBe('quest.downgrade.agent-checksum');
      expect(tampered.requests).toEqual([]);

      const harness = await createHarness({ backupComplete: false });
      const prepared = (await harness.prepare()).unwrap();
      expect((await prepared.run()).match({ ok: () => '', err: (error) => error.code })).toBe('quest.downgrade.backup-incomplete');
      expect(harness.requests).toEqual(['GetDowngradedManifest']);
   });
});

async function temporaryDir() {
   const dir = await mkdtemp(join(tmpdir(), 'encore-downgrade-test-'));
   dirs.push(dir);
   return dir;
}

async function createHarness(
   options: {
      backupComplete?: boolean;
      digest?: string;
   } = {}
) {
   const dir = await temporaryDir();
   const requests: string[] = [];
   let pendingRequest: string | null = null;
   const exec: AdbExec = async ({ args }) => {
      let stdout = '';
      if (args[2] === 'push' && args[3]?.endsWith('request.json')) {
         pendingRequest = requestSchema.parse(JSON.parse(await readFile(args[3], 'utf8'))).type;
      }
      if (args[2] === 'shell') {
         const command = args[3] ?? '';
         if (command === 'getprop ro.build.version.sdk') stdout = '32';
         else if (command.startsWith('sha256sum ')) stdout = `${options.digest ?? agentSha256}  agent`;
         else if (command.startsWith('test -e ')) stdout = options.backupComplete === false ? 'no' : 'yes';
         else if (command.startsWith('dumpsys package ')) stdout = `versionName=${plan.installedVersion}`;
         else if (command.includes(' < ')) {
            if (!pendingRequest) return Result.err({ code: 'fixture.missing-request', message: 'No agent request was uploaded' });
            requests.push(pendingRequest);
            if (pendingRequest === 'GetDowngradedManifest')
               stdout = JSON.stringify({ type: 'DowngradedManifest', manifest_xml: '<manifest package="com.beatgames.beatsaber" />' });
            pendingRequest = null;
         }
      }
      return Result.ok({ stdout, stderr: '' });
   };
   const client = createAdbClient({ adbPath: 'fixture-adb', exec });
   const connection = { client, serial: 'QUEST', gameVersion: plan.installedVersion, modloaderInstalled: false };
   const service = createQuestDowngrade({
      cacheRoot: dir,
      resources: { agent: async () => Result.ok({ path: join(dir, 'agent'), sha256: agentSha256 }) }
   });
   return { requests, prepare: () => service.prepare(connection, plan, new AbortController().signal) };
}
