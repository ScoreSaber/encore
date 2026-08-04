import { Result } from 'better-result';

import type { LaunchOptions } from '@/modules/launch/contract';
import { encoreProtocol, type ShortcutRequest } from '@/modules/shortcuts/contract';
import { parseBinaryVdf, serializeBinaryVdf, vdfMap, vdfText, type BinaryVdfMap, type BinaryVdfValue } from '@/modules/shortcuts/main/binary-vdf';
import { resolveLaunchLink } from '@/modules/shortcuts/main/launch-link-intake';
import type { ShortcutRuntime } from '@/modules/shortcuts/main/shortcut-runtime';
import { createShortcutService } from '@/modules/shortcuts/main/shortcut-service';

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) {
      await cleanup();
   }
   cleanups.length = 0;
});

describe('shortcut service', () => {
   test('adds a Steam shortcut without touching the entries Steam already had', async () => {
      const root = await mkdtemp(join(tmpdir(), 'encore-shortcuts-'));
      cleanups.push(() => rm(root, { recursive: true, force: true }));
      const steamShortcutsPath = join(root, 'steam', 'userdata', '12345', 'config', 'shortcuts.vdf');
      await mkdir(join(root, 'steam', 'userdata', '12345', 'config'), {
         recursive: true
      });
      const executablePath = join(root, 'app', 'encore');
      const install = { id: 'install_abcdef012345', name: 'Beat Saber 1.37.0' };
      const runtime: ShortcutRuntime = {
         platform: 'linux',
         executablePath,
         desktopPath: join(root, 'Desktop'),
         getSteamRoots: async () => [join(root, 'steam')],
         writeWindowsShortcut: () => Result.ok(undefined),
         getProtocolState: () => ({
            scheme: encoreProtocol,
            registered: false,
            canUnregister: false
         }),
         setProtocolRegistered: () => ({
            scheme: encoreProtocol,
            registered: true,
            canUnregister: false
         })
      };
      const shortcuts = createShortcutService({
         runtime,
         getInstall: async () => install
      });
      const other: BinaryVdfMap = new Map<string, BinaryVdfValue>([
         ['appid', 12],
         ['AppName', 'Another game'],
         ['Exe', '"/games/another"'],
         ['SomeFutureField', 'kept']
      ]);
      await writeFile(steamShortcutsPath, serializeBinaryVdf(new Map([['shortcuts', new Map([['0', other]]) as BinaryVdfMap]])));
      const options: LaunchOptions = {
         flags: ['fpfc'],
         args: ['--room', 'my room'],
         runAsAdmin: false
      };
      const request: ShortcutRequest = {
         targetId: 'local',
         installId: install.id,
         kind: 'steam',
         options
      };

      expect((await shortcuts.create(request)).ok).toBe(true);
      expect((await shortcuts.create(request)).ok).toBe(true);

      const entries = vdfMap(parseBinaryVdf(await readFile(steamShortcutsPath)).get('shortcuts'));
      expect(entries?.size).toBe(2);
      expect(vdfMap(entries?.get('0'))).toEqual(other);
      expect(vdfText(vdfMap(entries?.get('1'))?.get('AppName'))).toBe('Beat Saber 1.37.0');
      expect(vdfText(vdfMap(entries?.get('1'))?.get('LaunchOptions'))).toContain('encore://launch?target=local&install=install_abcdef012345');
   });
});

describe('launch link intake', () => {
   test('resolves a link against the installs that exist right now', async () => {
      const install = { id: 'install_abcdef012345', name: 'Beat Saber 1.37.0' };
      const getInstall = async (request: { installId: string }) => (request.installId === install.id ? install : null);

      expect(await resolveLaunchLink(`encore://launch?install=${install.id}&flag=fpfc`, getInstall)).toEqual({
         status: 'ready',
         request: {
            targetId: 'local',
            installId: install.id,
            options: { flags: ['fpfc'], args: [], runAsAdmin: false }
         },
         installName: install.name
      });
      expect(await resolveLaunchLink('encore://launch?install=install_000000000000', getInstall)).toEqual({
         status: 'rejected',
         issue: 'unknown-install',
         detail: 'install_000000000000'
      });
      expect(await resolveLaunchLink('encore://launch?install=/bin/sh', getInstall)).toEqual({ status: 'rejected', issue: 'invalid-request' });
   });
});
