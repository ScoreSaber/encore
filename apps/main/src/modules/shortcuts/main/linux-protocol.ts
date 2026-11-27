import { Result } from 'better-result';

import { causeCode, createProblem, type Problem } from '@/lib/errors';
import { writeFileAtomic } from '@/lib/filesystem/atomic-write';
import { createSerialQueue } from '@/lib/state/machine';
import { desktopExecArg } from '@/modules/shortcuts/main/desktop-entry';

import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
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

export type LinuxProtocolProblem = Problem<'shortcuts.protocol-change-failed'>;

function protocolFailure(cause: unknown): LinuxProtocolProblem {
   return createProblem('shortcuts.protocol-change-failed', { cause });
}

export async function queryLinuxProtocolDefault(scheme: string): Promise<Result<string, LinuxProtocolProblem>> {
   if (process.env.FLATPAK_ID) return Result.err(protocolFailure('Change link handlers in your host desktop settings outside Flatpak'));
   const mime = `x-scheme-handler/${scheme}`;
   const options = commandOptions;
   const gio = await Result.tryPromise({
      try: () => run('gio', ['mime', mime], { ...options, env: { ...process.env, LC_ALL: 'C' } }),
      catch: protocolFailure
   });
   if (Result.isOk(gio)) return Result.ok(gio.value.stdout.match(/^Default application for .*?:\s*([^\r\n]+)$/m)?.[1]?.trim() ?? '');

   const queried = await Result.tryPromise({
      try: async () => (await run('xdg-mime', ['query', 'default', mime], options)).stdout.trim(),
      catch: protocolFailure
   });
   if (Result.isError(queried)) return Result.err(queried.error);
   // Some backends advertise handlers that the user explicitly removed.
   const config = await Result.tryPromise({ try: () => readFile(join(configHome(), 'mimeapps.list'), 'utf8'), catch: (cause) => cause });
   if (Result.isError(config)) return causeCode(config.error) === 'ENOENT' ? queried : Result.err(protocolFailure(config.error));
   const removed = config.value.split(/^\[Removed Associations\]\s*$/m)[1]?.split(/^\[/m)[0];
   const entry = removed?.split(/\r?\n/).find((line) => line.startsWith(`${mime}=`));
   return Result.ok(
      entry
         ?.slice(mime.length + 1)
         .split(';')
         .includes(queried.value)
         ? ''
         : queried.value
   );
}

async function readOptional(path: string): Promise<Result<string | null, LinuxProtocolProblem>> {
   const read = await Result.tryPromise({ try: () => readFile(path, 'utf8'), catch: (cause) => cause });
   if (Result.isOk(read)) return Result.ok(read.value);
   return causeCode(read.error) === 'ENOENT' ? Result.ok(null) : Result.err(protocolFailure(read.error));
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

export async function isLinuxProtocolRegistered(scheme: string, packaged: boolean) {
   const current = await queryLinuxProtocolDefault(scheme);
   return Result.isOk(current) && (current.value === desktopId(scheme) || (packaged && nativeDesktopIds.includes(current.value)));
}

export function registerLinuxProtocols(schemes: readonly string[], command: readonly string[]) {
   return registrations.run(async (): Promise<Result<void, LinuxProtocolProblem>> => {
      if (process.env.FLATPAK_ID) return Result.err(protocolFailure('Change link handlers in your host desktop settings outside Flatpak'));
      if (command.some((arg) => /[\r\n]/.test(arg))) return Result.err(protocolFailure('The Encore launcher path contains a newline'));

      if (schemes.length > 0) {
         const created = await Result.tryPromise({ try: () => mkdir(configHome(), { recursive: true }), catch: protocolFailure });
         if (Result.isError(created)) return Result.err(created.error);
      }
      for (const scheme of schemes) {
         const queried = await queryLinuxProtocolDefault(scheme);
         if (Result.isError(queried)) return Result.err(queried.error);
         const current = queried.value;
         const existing = current === desktopId(scheme) ? await readOptional(desktopPath(scheme)) : Result.ok(null);
         if (Result.isError(existing)) return Result.err(existing.error);
         const previous = current === desktopId(scheme) ? existing.value?.match(/^X-Encore-PreviousHandler=(.+)$/m)?.[1] : current;
         const entry = [
            '[Desktop Entry]',
            'Type=Application',
            'Name=Encore',
            'NoDisplay=true',
            `Exec=${command.map(desktopExecArg).join(' ')} %u`,
            `MimeType=x-scheme-handler/${scheme};`,
            ...(previous && desktopIdPattern.test(previous) && !nativeDesktopIds.includes(previous) ? [`X-Encore-PreviousHandler=${previous}`] : []),
            ''
         ].join('\n');
         const written = await writeFileAtomic(desktopPath(scheme), entry);
         if (Result.isError(written)) return Result.err(protocolFailure(written.error.detail ?? written.error.message));

         const selected = await Result.tryPromise({
            try: () => run('xdg-mime', ['default', desktopId(scheme), `x-scheme-handler/${scheme}`], commandOptions),
            catch: protocolFailure
         });
         if (Result.isError(selected)) return Result.err(selected.error);
         const verified = await queryLinuxProtocolDefault(scheme);
         if (Result.isError(verified)) return Result.err(verified.error);
         if (verified.value !== desktopId(scheme)) return Result.err(protocolFailure(`Linux did not select Encore for ${scheme}://`));
      }
      return Result.ok();
   });
}

export function unregisterLinuxProtocols(schemes: readonly string[], isNativeDefault: (scheme: string) => boolean) {
   return registrations.run(async (): Promise<Result<void, LinuxProtocolProblem>> => {
      if (process.env.FLATPAK_ID) return Result.err(protocolFailure('Change link handlers in your host desktop settings outside Flatpak'));
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
         const mime = `x-scheme-handler/${scheme}`;
         const queried = await queryLinuxProtocolDefault(scheme);
         if (Result.isError(queried)) return Result.err(queried.error);
         const current = queried.value;
         const ownEntry = await readOptional(desktopPath(scheme));
         if (Result.isError(ownEntry)) return Result.err(ownEntry.error);
         const owned = new Set([desktopId(scheme), ...nativeDesktopIds]);
         if (desktopIdPattern.test(current)) {
            const native = Result.try({ try: () => isNativeDefault(scheme), catch: protocolFailure });
            if (Result.isError(native)) return Result.err(native.error);
            if (native.value) owned.add(current);
         }
         const previous = ownEntry.value?.match(/^X-Encore-PreviousHandler=(.+)$/m)?.[1];
         const removeOwned = (ids: string[]) => ids.filter((id) => !owned.has(id));
         for (const path of new Set(files)) {
            const read = await readOptional(path);
            if (Result.isError(read)) return Result.err(read.error);
            if (read.value === null && path !== userConfig) continue;
            const original = read.value?.split(/\r?\n/) ?? [];
            const lines = [...original];
            updateAssociation(lines, 'Default Applications', mime, removeOwned);
            if (path.endsWith('/mimeapps.list')) updateAssociation(lines, 'Added Associations', mime, removeOwned);
            if (path === userConfig) {
               updateAssociation(lines, 'Removed Associations', mime, (ids) => [
                  ...new Set([...ids, ...[...owned].filter((id) => id !== desktopId(scheme))])
               ]);
            }
            const next = lines.join('\n');
            if (next !== original.join('\n')) {
               const written = await writeFileAtomic(path, next.endsWith('\n') ? next : `${next}\n`);
               if (Result.isError(written)) return Result.err(protocolFailure(written.error.detail ?? written.error.message));
            }
         }
         let previousAvailable = false;
         if (previous && desktopIdPattern.test(previous) && !owned.has(previous)) {
            const locations = [
               applicationsPath(),
               ...(process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').map((path) => join(path, 'applications'))
            ];
            for (const location of locations) {
               const entry = await readOptional(join(location, previous));
               if (Result.isError(entry)) return Result.err(entry.error);
               if (entry.value === null) continue;
               previousAvailable = !/^Hidden=true\s*$/m.test(entry.value) && /^Exec=.+$/m.test(entry.value);
               const tryExec = entry.value.match(/^TryExec=(.+)$/m)?.[1]?.trim();
               if (previousAvailable && tryExec) {
                  const candidates = isAbsolute(tryExec)
                     ? [tryExec]
                     : tryExec.includes('/')
                       ? []
                       : (process.env.PATH ?? '').split(delimiter).map((path) => join(path, tryExec));
                  previousAvailable = false;
                  for (const candidate of candidates) {
                     const executable = await Result.tryPromise(async () => {
                        await access(candidate, constants.X_OK);
                        return (await stat(candidate)).isFile();
                     });
                     if (Result.isOk(executable) && executable.value) {
                        previousAvailable = true;
                        break;
                     }
                  }
               }
               break;
            }
         }
         if (current === desktopId(scheme) && previous && previousAvailable) {
            const restored = await queryLinuxProtocolDefault(scheme);
            if (Result.isError(restored)) return Result.err(restored.error);
            if (restored.value !== previous) {
               const selected = await Result.tryPromise({
                  try: () => run('xdg-mime', ['default', previous, mime], commandOptions),
                  catch: protocolFailure
               });
               if (Result.isError(selected)) return Result.err(selected.error);
               const restoredDefault = await queryLinuxProtocolDefault(scheme);
               if (Result.isError(restoredDefault)) return Result.err(restoredDefault.error);
               if (restoredDefault.value !== previous)
                  return Result.err(protocolFailure(`Linux did not restore the previous handler for ${scheme}://`));
            }
         }
         const removed = await Result.tryPromise({ try: () => rm(desktopPath(scheme), { force: true }), catch: protocolFailure });
         if (Result.isError(removed)) return Result.err(removed.error);
         const verified = await queryLinuxProtocolDefault(scheme);
         if (Result.isError(verified)) return Result.err(verified.error);
         if (owned.has(verified.value)) return Result.err(protocolFailure(`Linux still selects Encore for ${scheme}://`));
      }
      return Result.ok();
   });
}
