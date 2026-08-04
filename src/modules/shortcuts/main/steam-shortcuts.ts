import { Result } from 'better-result';
import { buf as crc32 } from 'crc-32';

import { causeCode } from '@/lib/errors';
import { pathExists } from '@/lib/filesystem/path';
import { parseBinaryVdf, serializeBinaryVdf, vdfMap, vdfText, type BinaryVdfMap } from '@/modules/shortcuts/main/binary-vdf';

import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const shortcutsRootKey = 'shortcuts';

export type SteamShortcutProblem = {
   issue: 'steam-client-missing' | 'steam-user-missing' | 'steam-file-unreadable' | 'write-failed';
   detail?: string;
};

export type SteamShortcutFile = {
   path: string;
   root: BinaryVdfMap;
   entries: BinaryVdfMap;
};

export type SteamShortcutEntry = {
   appName: string;
   executablePath: string;
   startDirectory: string;
   launchOptions: string;
};

export async function findSteamShortcutsPath(roots: readonly string[]): Promise<Result<string, SteamShortcutProblem>> {
   let steamRoot: string | null = null;

   for (const root of roots) {
      const userdataPath = join(root, 'userdata');
      const exists = await pathExists(userdataPath);
      if (Result.isError(exists) || !exists.value) continue;

      steamRoot = root;
      const userPath = await findNewestUserPath(userdataPath);
      if (userPath) return Result.ok(join(userPath, 'config', 'shortcuts.vdf'));
   }

   if (steamRoot) return Result.err({ issue: 'steam-user-missing', detail: join(steamRoot, 'userdata') });

   return Result.err({ issue: 'steam-client-missing' });
}

export async function readSteamShortcuts(path: string): Promise<Result<SteamShortcutFile, SteamShortcutProblem>> {
   const exists = await pathExists(path);
   if (Result.isError(exists)) return Result.err({ issue: 'steam-file-unreadable', detail: exists.error.detail });

   if (!exists.value) {
      const entries: BinaryVdfMap = new Map();
      return Result.ok({ path, root: new Map([[shortcutsRootKey, entries]]), entries });
   }

   const parsed = await Result.tryPromise({
      try: async () => parseBinaryVdf(await readFile(path)),
      catch: (cause) => causeCode(cause)
   });

   if (Result.isError(parsed)) return Result.err({ issue: 'steam-file-unreadable', detail: parsed.error });

   const entries = vdfMap(parsed.value.get(shortcutsRootKey));
   if (!entries) return Result.err({ issue: 'steam-file-unreadable', detail: 'no shortcuts section' });

   return Result.ok({ path, root: parsed.value, entries });
}

export function findSteamShortcutKey(file: SteamShortcutFile, appName: string) {
   for (const [key, value] of file.entries) {
      const entry = vdfMap(value);
      if (entry && vdfText(entry.get('AppName')) === appName) return key;
   }

   return null;
}

export function upsertSteamShortcut(file: SteamShortcutFile, entry: SteamShortcutEntry) {
   const existingKey = findSteamShortcutKey(file, entry.appName);
   const existing = existingKey === null ? null : vdfMap(file.entries.get(existingKey));
   const next: BinaryVdfMap = existing ?? new Map();

   next.set('appid', steamShortcutAppId(entry));
   next.set('AppName', entry.appName);
   next.set('Exe', quoteForSteam(entry.executablePath));
   next.set('StartDir', quoteForSteam(entry.startDirectory));
   next.set('icon', existing ? (vdfText(existing.get('icon')) ?? '') : '');
   next.set('ShortcutPath', '');
   next.set('LaunchOptions', entry.launchOptions);
   next.set('IsHidden', 0);
   next.set('AllowDesktopConfig', 1);
   next.set('AllowOverlay', 1);
   next.set('OpenVR', 1);
   next.set('Devkit', 0);
   next.set('DevkitGameID', '');
   next.set('DevkitOverrideAppID', 0);
   next.set('LastPlayTime', existing ? (existing.get('LastPlayTime') ?? 0) : 0);
   next.set('tags', vdfMap(next.get('tags')) ?? new Map());

   if (existingKey === null) file.entries.set(String(file.entries.size), next);

   const values = [...file.entries.values()];
   file.entries.clear();
   values.forEach((value, index) => file.entries.set(String(index), value));

   return file;
}

export async function writeSteamShortcuts(file: SteamShortcutFile): Promise<Result<void, SteamShortcutProblem>> {
   const temporaryPath = `${file.path}.encore-tmp`;

   const written = await Result.tryPromise({
      try: async () => {
         await mkdir(dirname(file.path), { recursive: true });
         await writeFile(temporaryPath, serializeBinaryVdf(file.root));
         await rename(temporaryPath, file.path);
      },
      catch: (cause) => causeCode(cause)
   });

   if (Result.isError(written)) return Result.err({ issue: 'write-failed', detail: written.error });

   return Result.ok(undefined);
}

export function steamShortcutAppId(entry: SteamShortcutEntry) {
   return crc32(Buffer.from(`${quoteForSteam(entry.executablePath)}${entry.appName}`, 'utf8')) | 0x8000_0000;
}

function quoteForSteam(value: string) {
   return `"${value.replaceAll('"', '')}"`;
}

async function findNewestUserPath(userdataPath: string) {
   const entries = await Result.tryPromise({
      try: () => readdir(userdataPath, { withFileTypes: true }),
      catch: () => null
   });

   if (Result.isError(entries)) return null;

   let newestPath: string | null = null;
   let newestTime = -1;

   for (const entry of entries.value) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name) || entry.name === '0') continue;

      const userPath = join(userdataPath, entry.name);
      const info = await Result.tryPromise({
         try: () => stat(join(userPath, 'config')),
         catch: () => null
      });

      if (Result.isError(info)) continue;

      if (info.value.mtimeMs > newestTime) {
         newestTime = info.value.mtimeMs;
         newestPath = userPath;
      }
   }

   return newestPath;
}
