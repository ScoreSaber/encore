import { Result } from 'better-result';

import { createProblem } from '@/lib/errors';
import { pathExists, readPathInfo, resolveFilesystemPath } from '@/lib/filesystem/path';
import type { InstallFolderIssue } from '@/modules/installs/contract';

import { open, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export const beatSaberExecutableName = 'Beat Saber.exe';
export const beatSaberDataDirectoryName = 'Beat Saber_Data';

const headerScanBytes = 4096;
const peMachineArm64 = 0xaa64;
const peMachineArm64Ec = 0xa641;
const versionAnchor = 'public.app-category.games';
const versionWindowBytes = 256;
const maxScanBytes = 512 * 1024;
const versionPattern = /\d+\.\d+\.\d+/;
const unityVersionPattern = /\d{4}\.\d+\.\d+[abfp]\d+/;

type InstallFolderInspection =
   | { status: 'invalid'; path: string; issue: InstallFolderIssue; detail?: string }
   | { status: 'ok'; path: string; version: string };

export function beatSaberExecutablePath(installPath: string) {
   return join(installPath, beatSaberExecutableName);
}

export async function isArm64Image(filePath: string) {
   const read = await readFileHead(filePath, headerScanBytes);
   if (Result.isError(read)) return false;

   const header = read.value;
   if (header.length < 0x40 || header.toString('latin1', 0, 2) !== 'MZ') return false;
   const peOffset = header.readUInt32LE(0x3c);
   if (peOffset + 6 > header.length || header.toString('latin1', peOffset, peOffset + 4) !== 'PE\0\0') return false;

   const machine = header.readUInt16LE(peOffset + 4);
   return machine === peMachineArm64 || machine === peMachineArm64Ec;
}

export async function readBeatSaberVersion(installPath: string) {
   const read = await readFileHead(join(installPath, beatSaberDataDirectoryName, 'globalgamemanagers'), maxScanBytes);
   if (Result.isError(read)) return null;

   const contents = read.value.toString('latin1');
   const anchorIndex = contents.indexOf(versionAnchor);
   if (anchorIndex < 0) return null;

   const start = anchorIndex + versionAnchor.length;
   return versionPattern.exec(contents.slice(start, start + versionWindowBytes))?.[0] ?? null;
}

export async function readUnityVersion(installPath: string) {
   const read = await readFileHead(join(installPath, beatSaberDataDirectoryName, 'globalgamemanagers'), headerScanBytes);
   return Result.isOk(read) ? (unityVersionPattern.exec(read.value.toString('latin1'))?.[0] ?? null) : null;
}

function readFileHead(filePath: string, maxBytes: number) {
   return Result.tryPromise({
      try: async () => {
         const handle = await open(filePath, 'r');

         try {
            const buffer = Buffer.alloc(maxBytes);
            const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
            return buffer.subarray(0, bytesRead);
         } finally {
            await handle.close();
         }
      },
      catch: () => null
   });
}

export async function inspectInstallFolder(sourcePath: string): Promise<InstallFolderInspection> {
   const trimmed = sourcePath.trim();
   if (!trimmed || !isAbsolute(trimmed)) return invalid(trimmed, 'not-absolute');

   const path = resolveFilesystemPath(trimmed);
   const info = await readPathInfo(path);
   if (Result.isError(info)) return invalid(path, info.error.detail === 'ENOENT' ? 'not-found' : 'inspect-failed', info.error.detail);
   if (info.value.kind !== 'directory') return invalid(path, 'not-a-directory');

   const entries = await Result.tryPromise({
      try: () => readdir(path),
      catch: (cause) => createProblem('filesystem.path.inspect-failed', { path, cause })
   });
   if (Result.isError(entries)) return invalid(path, 'inspect-failed', entries.error.detail);

   const executableName = beatSaberExecutableName.toLowerCase();
   if (!entries.value.some((entry) => entry.toLowerCase() === executableName)) return invalid(path, 'missing-executable');

   const gameData = await pathExists(join(path, beatSaberDataDirectoryName, 'globalgamemanagers'));
   if (Result.isError(gameData)) return invalid(path, 'inspect-failed', gameData.error.detail);
   if (!gameData.value) return invalid(path, 'missing-game-data');

   const version = await readBeatSaberVersion(path);
   return version ? { status: 'ok', path, version } : invalid(path, 'unknown-version');
}

function invalid(path: string, issue: InstallFolderIssue, detail?: string): InstallFolderInspection {
   const inspection: InstallFolderInspection = { status: 'invalid', path, issue };
   if (detail) inspection.detail = detail;
   return inspection;
}
