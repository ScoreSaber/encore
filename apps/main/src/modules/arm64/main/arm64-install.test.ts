import { Result } from 'better-result';
import { afterEach, expect, test } from 'vite-plus/test';

import { enterNative, leaveNative, undoOtherToolConversion } from '@/modules/arm64/main/arm64-install';

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

function image(machine: number, body: string) {
   const header = Buffer.alloc(0x88);
   header.write('MZ', 0, 'latin1');
   header.writeUInt32LE(0x80, 0x3c);
   header.write('PE\0\0', 0x80, 'latin1');
   header.writeUInt16LE(machine, 0x84);
   return Buffer.concat([header, Buffer.from(body)]);
}

const x64 = (body: string) => image(0x8664, body);
const arm64 = (body: string) => image(0xaa64, body);

async function createTree(files: Record<string, Buffer>) {
   const root = await mkdtemp(join(tmpdir(), 'encore-arm64-'));
   tempRoots.push(root);
   for (const [path, data] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), data);
   }
   return root;
}

async function readTree(root: string) {
   const entries = await readdir(root, { recursive: true, withFileTypes: true });
   const files: Record<string, string> = {};
   for (const entry of entries.filter((candidate) => candidate.isFile()).toSorted((a, b) => a.name.localeCompare(b.name))) {
      const path = join(entry.parentPath, entry.name);
      files[relative(root, path)] = (await readFile(path)).toString('latin1');
   }
   return files;
}

test('a native swap goes back to the exact files it replaced', async () => {
   const install = await createTree({
      'Beat Saber.exe': x64('game'),
      'winhttp.dll': x64('mod loader'),
      'Libs/MonoMod.Core.dll': Buffer.from('MZ 1.3.3+aa4a84749'),
      'UserData/settings.json': Buffer.from('{}')
   });
   const assets = await createTree({
      'Beat Saber.exe': arm64('game'),
      'Beat Saber_Data/Plugins/ARM64/steam_api64.dll': arm64('steam'),
      'winhttp.dll': arm64('mod loader'),
      'MonoMod.Core.dll': Buffer.from('MZ 1.3.4'),
      'unused.dll': arm64('unused')
   });
   const original = await readTree(install);
   const placements = [
      { target: 'Beat Saber.exe', source: join(assets, 'Beat Saber.exe') },
      { target: 'Beat Saber_Data/Plugins/ARM64/steam_api64.dll', source: join(assets, 'Beat Saber_Data/Plugins/ARM64/steam_api64.dll') },
      { target: 'winhttp.dll', source: join(assets, 'winhttp.dll'), replaces: /^MZ/ },
      { target: 'Libs/MonoMod.Core.dll', source: join(assets, 'MonoMod.Core.dll'), replaces: /1\.3\.3/ },
      { target: 'Libs/Missing.dll', source: join(assets, 'unused.dll'), replaces: /^MZ/ }
   ];

   expect(Result.isOk(await enterNative(install, 'v1', placements))).toBe(true);
   const native = await readTree(install);
   expect(native['Beat Saber.exe']).toBe(arm64('game').toString('latin1'));
   expect(native['Libs/MonoMod.Core.dll']).toBe('MZ 1.3.4');
   expect(native['Libs/Missing.dll']).toBeUndefined();

   expect(Result.isOk(await enterNative(install, 'v1', placements))).toBe(true);
   expect(await readTree(install)).toEqual(native);

   expect(Result.isOk(await leaveNative(install))).toBe(true);
   expect(await readTree(install)).toEqual(original);
});

test('files replaced while native survive the way back', async () => {
   const install = await createTree({ 'Beat Saber.exe': x64('game'), 'winhttp.dll': x64('mod loader') });
   const assets = await createTree({ 'Beat Saber.exe': arm64('game'), 'winhttp.dll': arm64('mod loader') });
   const placements = [
      { target: 'Beat Saber.exe', source: join(assets, 'Beat Saber.exe') },
      { target: 'winhttp.dll', source: join(assets, 'winhttp.dll'), replaces: /^MZ/ }
   ];

   await enterNative(install, 'v1', placements);
   await writeFile(join(install, 'winhttp.dll'), x64('newer mod loader'));
   await enterNative(install, 'v1', placements);
   expect((await readTree(install))['winhttp.dll']).toBe(arm64('mod loader').toString('latin1'));

   await writeFile(join(install, 'winhttp.dll'), x64('newest mod loader'));
   await leaveNative(install);
   expect(await readTree(install)).toEqual({
      'Beat Saber.exe': x64('game').toString('latin1'),
      'winhttp.dll': x64('newest mod loader').toString('latin1')
   });
});

test('a copy converted by the BSManager fork goes back to x64', async () => {
   const install = await createTree({
      'Beat Saber.exe': arm64('game'),
      'd3d11.dll': arm64('dxvk'),
      'Beat Saber_Data/Plugins/ARM64/steam_api64.dll': arm64('steam'),
      'UserData/settings.json': Buffer.from('{}'),
      '.bs-arm64/backup/Beat Saber.exe': x64('game'),
      '.bs-arm64/backup/winhttp.dll': x64('removed mod loader'),
      '.bs-arm64/added': Buffer.from('d3d11.dll\nBeat Saber_Data/Plugins/ARM64/steam_api64.dll\n')
   });

   expect(Result.isOk(await undoOtherToolConversion(install))).toBe(true);
   expect(await readTree(install)).toEqual({ 'Beat Saber.exe': x64('game').toString('latin1'), 'UserData/settings.json': '{}' });
});
