import { Result } from 'better-result';

import { writeFileAtomic } from '@/lib/filesystem/atomic-write';
import { createSerialQueue } from '@/lib/state/machine';

import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const registrations = createSerialQueue();
const nativeDesktopIds = ['com.scoresaber.encore.desktop', 'encore.desktop'];
const desktopIdPattern = /^[a-zA-Z0-9_.+@-]+\.desktop$/;
const run = promisify(execFile);
const commandOptions = { encoding: 'utf8', timeout: 3000 } as const;

function desktopId(scheme: string) {
   return `com.scoresaber.encore-url-${scheme}.desktop`;
}

function configHome() {
   return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

function applicationsPath() {
   return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'applications');
}

function desktopPath(scheme: string) {
   return join(applicationsPath(), desktopId(scheme));
}

function gioDefault(output: string) {
   return output.match(/^Default application for .*?:\s*([^\r\n]+)$/m)?.[1]?.trim() ?? '';
}

function queryDefault(scheme: string) {
   const mime = handler(scheme);
   const options = { ...commandOptions, env: { ...process.env, LC_ALL: 'C' } };
   try {
      return gioDefault(execFileSync('gio', ['mime', mime], { ...options, stdio: ['ignore', 'pipe', 'ignore'] }));
   } catch {
      const id = execFileSync('xdg-mime', ['query', 'default', mime], { ...commandOptions, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      // Some xdg-mime backends list an advertised handler even after it was removed in mimeapps.list.
      try {
         const config = readFileSync(join(configHome(), 'mimeapps.list'), 'utf8');
         const removed = config.split(/^\[Removed Associations\]\s*$/m)[1]?.split(/^\[/m)[0];
         const entry = removed?.split(/\r?\n/).find((line) => line.startsWith(`${mime}=`));
         if (
            entry
               ?.slice(mime.length + 1)
               .split(';')
               .includes(id)
         )
            return '';
      } catch {
         // A missing user configuration leaves the desktop default in effect.
      }
      return id;
   }
}

async function readOptional(path: string) {
   try {
      return await readFile(path, 'utf8');
   } catch (cause) {
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') return null;
      throw cause;
   }
}

function updateAssociation(lines: string[], section: string, mime: string, update: (ids: string[]) => string[]) {
   const start = lines.indexOf(`[${section}]`);
   const end = start < 0 ? -1 : lines.findIndex((line, index) => index > start && line.trim().startsWith('['));
   const index = start < 0 ? -1 : lines.findIndex((line, index) => index > start && (end < 0 || index < end) && line.startsWith(`${mime}=`));
   const current = (lines[index] ?? '')
      .slice(mime.length + 1)
      .split(';')
      .map((id) => id.trim())
      .filter(Boolean);
   const next = update(current);
   if (current.length === next.length && current.every((id, offset) => id === next[offset])) return;
   if (next.length === 0) {
      if (index >= 0) lines.splice(index, 1);
      return;
   }

   const entry = `${mime}=${next.join(';')};`;
   if (index >= 0) lines[index] = entry;
   else if (start >= 0) lines.splice(end < 0 ? lines.length : end, 0, entry);
   else lines.push(`[${section}]`, entry);
}

async function writeConfiguration(path: string, contents: string) {
   const written = await writeFileAtomic(path, contents);
   if (Result.isError(written)) throw new Error(written.error.detail ?? written.error.message);
}

function handler(scheme: string) {
   return `x-scheme-handler/${scheme}`;
}

export function desktopExecArg(value: string) {
   return `"${value.replaceAll(/["`$\\]/g, '\\$&')}"`.replaceAll('\\', '\\\\').replaceAll('%', '%%');
}

export function isLinuxProtocolRegistered(scheme: string, packaged: boolean) {
   try {
      const current = queryDefault(scheme);
      return current === desktopId(scheme) || (packaged && nativeDesktopIds.includes(current));
   } catch {
      return false;
   }
}

export function registerLinuxProtocols(schemes: readonly string[], command: readonly string[]) {
   return registrations.run(async () => {
      if (command.some((arg) => /[\r\n]/.test(arg))) throw new Error('The Encore launcher path contains a newline');

      if (schemes.length > 0) await mkdir(configHome(), { recursive: true });
      for (const scheme of schemes) {
         const current = queryDefault(scheme);
         const previous =
            current === desktopId(scheme) ? (await readOptional(desktopPath(scheme)))?.match(/^X-Encore-PreviousHandler=(.+)$/m)?.[1] : current;
         const entry = [
            '[Desktop Entry]',
            'Type=Application',
            'Name=Encore',
            'NoDisplay=true',
            `Exec=${command.map(desktopExecArg).join(' ')} %u`,
            `MimeType=${handler(scheme)};`,
            ...(previous && desktopIdPattern.test(previous) && !nativeDesktopIds.includes(previous) ? [`X-Encore-PreviousHandler=${previous}`] : []),
            ''
         ].join('\n');
         await writeConfiguration(desktopPath(scheme), entry);

         await run('xdg-mime', ['default', desktopId(scheme), handler(scheme)], commandOptions);
         if (queryDefault(scheme) !== desktopId(scheme)) throw new Error(`Linux did not select Encore for ${scheme}://`);
      }
   });
}

export function unregisterLinuxProtocols(schemes: readonly string[], isNativeDefault: (scheme: string) => boolean) {
   return registrations.run(async () => {
      const configPath = configHome();
      const desktops = (process.env.XDG_CURRENT_DESKTOP ?? '')
         .toLowerCase()
         .split(':')
         .filter((name) => /^[a-z0-9_-]+$/.test(name));
      const userConfig = join(configPath, 'mimeapps.list');
      const files = [configPath, applicationsPath()].flatMap((base) => [
         ...desktops.map((desktop) => join(base, `${desktop}-mimeapps.list`)),
         join(base, 'mimeapps.list')
      ]);

      for (const scheme of schemes) {
         const mime = handler(scheme);
         const current = queryDefault(scheme);
         const ownEntry = await readOptional(desktopPath(scheme));
         const owned = new Set([desktopId(scheme), ...nativeDesktopIds]);
         if (desktopIdPattern.test(current) && isNativeDefault(scheme)) owned.add(current);
         const previous = ownEntry?.match(/^X-Encore-PreviousHandler=(.+)$/m)?.[1];
         const removeOwned = (ids: string[]) => ids.filter((id) => !owned.has(id));
         for (const path of new Set(files)) {
            const text = await readOptional(path);
            if (text === null && path !== userConfig) continue;
            const original = text?.split(/\r?\n/) ?? [];
            const lines = [...original];
            updateAssociation(lines, 'Default Applications', mime, removeOwned);
            if (path.endsWith('/mimeapps.list')) updateAssociation(lines, 'Added Associations', mime, removeOwned);
            if (path === userConfig) {
               updateAssociation(lines, 'Removed Associations', mime, (ids) => [
                  ...new Set([...ids, ...[...owned].filter((id) => id !== desktopId(scheme))])
               ]);
            }
            const next = lines.join('\n');
            if (next !== original.join('\n')) await writeConfiguration(path, next.endsWith('\n') ? next : `${next}\n`);
         }
         await rm(desktopPath(scheme), { force: true });
         if (current === desktopId(scheme) && previous && desktopIdPattern.test(previous) && !owned.has(previous)) {
            if (queryDefault(scheme) !== previous) {
               await run('xdg-mime', ['default', previous, mime], commandOptions).catch(() => undefined);
            }
         }
         if (owned.has(queryDefault(scheme))) throw new Error(`Linux still selects Encore for ${scheme}://`);
      }
   });
}
