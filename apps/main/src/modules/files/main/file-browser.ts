import { Result } from 'better-result';

import { causeMessage } from '@/lib/errors';
import type { DirectoryListing, FileEntry } from '@/modules/files/contract';

import { access, readdir, stat } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';

const maxEntries = 5_000;
const drivesPath = '';
const driveLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function createFileBrowser(options: { platform: NodeJS.Platform; home: string }) {
   const windows = options.platform === 'win32';

   async function list({ path }: { path: string | null }): Promise<DirectoryListing> {
      if (windows && path === drivesPath) return { status: 'ok', path: drivesPath, parent: null, entries: await drives(), truncated: false };

      const requested = path?.trim() || options.home;
      const current = resolve(windows && /^[a-z]:$/i.test(requested) ? `${requested}\\` : requested);
      const root = parse(current).root;
      const parent = current === root ? (windows ? drivesPath : null) : dirname(current);
      const read = await Result.tryPromise(() => readdir(current, { withFileTypes: true }));
      if (Result.isError(read)) return { status: 'unreadable', path: current, parent, detail: causeMessage(read.error) };

      const entries = await Promise.all(
         read.value.map(async (entry): Promise<FileEntry> => {
            const entryPath = join(current, entry.name);
            const directory = entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(entryPath)));
            return { name: entry.name, path: entryPath, kind: directory ? 'directory' : 'file' };
         })
      );
      const sorted = entries.toSorted(
         (first, second) =>
            Number(second.kind === 'directory') - Number(first.kind === 'directory') ||
            first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: 'base' })
      );

      return { status: 'ok', path: current, parent, entries: sorted.slice(0, maxEntries), truncated: sorted.length > maxEntries };
   }

   async function drives() {
      const found = await Promise.all(
         driveLetters.map(async (letter): Promise<FileEntry[]> => {
            const path = `${letter}:\\`;
            const reachable = await Result.tryPromise(() => access(path));
            return Result.isOk(reachable) ? [{ name: `${letter}:`, path, kind: 'directory' }] : [];
         })
      );
      return found.flat();
   }

   return { list };
}

async function isDirectory(path: string) {
   const info = await Result.tryPromise(() => stat(path));
   return Result.isOk(info) && info.value.isDirectory();
}
