import { Result } from 'better-result';
import { expect, onTestFinished, test } from 'vite-plus/test';

import { encoreProtocol, type ShortcutRequest } from '@/modules/shortcuts/contract';
import { parseBinaryVdf, serializeBinaryVdf, vdfMap, vdfText, type BinaryVdfValue } from '@/modules/shortcuts/main/binary-vdf';
import { createShortcutService } from '@/modules/shortcuts/main/shortcut-service';

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('adds a Steam shortcut without touching the entries Steam already had', async () => {
   const root = await mkdtemp(join(tmpdir(), 'encore-shortcuts-'));
   onTestFinished(() => rm(root, { recursive: true, force: true }));
   const configPath = join(root, 'steam', 'userdata', '12345', 'config');
   await mkdir(configPath, { recursive: true });
   const other = new Map<string, BinaryVdfValue>([
      ['appid', 12],
      ['AppName', 'Another game'],
      ['SomeFutureField', 'kept']
   ]);
   await writeFile(join(configPath, 'shortcuts.vdf'), serializeBinaryVdf(new Map([['shortcuts', new Map([['0', other]])]])));
   const shortcuts = createShortcutService({
      runtime: {
         platform: 'linux',
         executablePath: join(root, 'encore'),
         desktopPath: join(root, 'Desktop'),
         getSteamRoots: async () => [join(root, 'steam')],
         writeWindowsShortcut: () => Result.ok(undefined),
         getProtocolState: () => ({ scheme: encoreProtocol, registered: true, canUnregister: false }),
         setProtocolRegistered: () => ({ scheme: encoreProtocol, registered: true, canUnregister: false })
      },
      getInstall: async () => ({ id: 'install_abcdef012345', name: 'Beat Saber 1.37.0' })
   });
   const request: ShortcutRequest = {
      targetId: 'local',
      installId: 'install_abcdef012345',
      kind: 'steam',
      options: { flags: [], args: [], environment: { SOME_ENV_VAR: '1' }, runAsAdmin: false, closeEncore: false }
   };

   expect(Result.isOk(await shortcuts.create(request))).toBe(true);
   expect(Result.isOk(await shortcuts.create(request))).toBe(true);

   const entries = vdfMap(parseBinaryVdf(await readFile(join(configPath, 'shortcuts.vdf'))).get('shortcuts'));
   expect(entries?.size).toBe(2);
   expect(vdfMap(entries?.get('0'))).toEqual(other);
   expect(vdfText(vdfMap(entries?.get('1'))?.get('LaunchOptions'))).toContain('encore://launch?target=local&install=install_abcdef012345');
});

test('writes a desktop entry Exec line that survives percent-encoded args and reserved characters', async () => {
   const root = await mkdtemp(join(tmpdir(), 'encore-shortcuts-'));
   onTestFinished(() => rm(root, { recursive: true, force: true }));
   await mkdir(join(root, 'Desktop'));
   const shortcuts = createShortcutService({
      runtime: {
         platform: 'linux',
         executablePath: '/opt/My "$Apps"/Encore.AppImage',
         desktopPath: join(root, 'Desktop'),
         getSteamRoots: async () => [],
         writeWindowsShortcut: () => Result.ok(undefined),
         getProtocolState: () => ({ scheme: encoreProtocol, registered: true, canUnregister: false }),
         setProtocolRegistered: () => ({ scheme: encoreProtocol, registered: true, canUnregister: false })
      },
      getInstall: async () => ({ id: 'install_abcdef012345', name: 'Beat Saber' })
   });

   const created = await shortcuts.create({
      targetId: 'local',
      installId: 'install_abcdef012345',
      kind: 'desktop',
      options: { flags: [], args: ['100%', 'C:\\x'], environment: {}, runAsAdmin: false, closeEncore: false }
   });
   if (Result.isError(created)) throw new Error('the shortcut was not written');

   const entry = await readFile(join(root, 'Desktop', 'Beat Saber.desktop'), 'utf8');
   expect(entry).toContain(
      'Exec="/opt/My \\\\"\\\\$Apps\\\\"/Encore.AppImage" "encore://launch?target=local&install=install_abcdef012345&arg=100%%25&arg=C%%3A%%5Cx"\n'
   );
});
