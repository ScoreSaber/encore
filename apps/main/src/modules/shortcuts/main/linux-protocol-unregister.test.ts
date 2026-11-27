import { Result } from 'better-result';
import { beforeEach, expect, onTestFinished, test, vi } from 'vite-plus/test';

import { createProblem } from '@/lib/errors';
import { writeFileAtomic } from '@/lib/filesystem/atomic-write';
import { unregisterLinuxProtocols } from '@/modules/shortcuts/main/linux-protocol';

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const commands = vi.hoisted(() => ({ current: '', entry: '', fail: false, unchanged: false, calls: [] as string[][] }));
vi.mock('node:child_process', () => ({
   execFile: (command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout?: { stdout: string }) => void) => {
      if (command === 'gio') {
         const current = commands.current === 'com.scoresaber.encore-url-beatsaver.desktop' && !existsSync(commands.entry) ? '' : commands.current;
         callback(null, { stdout: `Default application for ${args[1]}: ${current}\n` });
         return;
      }
      commands.calls.push(args);
      if (commands.fail) callback(new Error('desktop command failed'));
      else {
         if (!commands.unchanged) commands.current = args[1] ?? '';
         callback(null, { stdout: '' });
      }
   }
}));
vi.mock('@/lib/filesystem/atomic-write', async (importOriginal) => ({
   ...(await importOriginal<typeof import('@/lib/filesystem/atomic-write')>()),
   writeFileAtomic: vi.fn((...args: Parameters<typeof writeFileAtomic>) =>
      importOriginal<typeof import('@/lib/filesystem/atomic-write')>().then((module) => module.writeFileAtomic(...args))
   )
}));

const own = 'com.scoresaber.encore-url-beatsaver.desktop';
const mime = 'x-scheme-handler/beatsaver';
let config: string;
let applications: string;

beforeEach(async () => {
   const root = await mkdtemp(join(tmpdir(), 'encore-unregister-'));
   config = join(root, 'config');
   applications = join(root, 'applications');
   await mkdir(config);
   await mkdir(applications);
   vi.stubEnv('XDG_CONFIG_HOME', config);
   vi.stubEnv('XDG_DATA_HOME', root);
   vi.stubEnv('XDG_CURRENT_DESKTOP', 'GNOME:KDE');
   vi.mocked(writeFileAtomic).mockClear();
   commands.current = own;
   commands.entry = join(applications, own);
   commands.fail = false;
   commands.unchanged = false;
   commands.calls = [];
   await writeFile(join(applications, 'previous.desktop'), '[Desktop Entry]\nType=Application\nExec=/usr/bin/true %u\n');
   await writeFile(commands.entry, '[Desktop Entry]\nX-Encore-PreviousHandler=previous.desktop\n');
   onTestFinished(async () => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
   });
});

// Assert the public Result contract, including failures that must not reject the promise.
async function remove() {
   return await unregisterLinuxProtocols(['beatsaver'], () => false);
}

test('restores the previous handler and removes its generated desktop entry', async () => {
   await writeFile(join(config, 'mimeapps.list'), `[Default Applications]\n${mime}=${own};\n`);
   const result = await remove();
   expect(result).toMatchObject({ status: 'ok' });
   expect(commands.calls).toContainEqual(['default', 'previous.desktop', mime]);
   expect(commands.current).toBe('previous.desktop');
   expect(existsSync(commands.entry)).toBe(false);
});

test('preserves other handlers, schemes, sections and desktop-specific configuration', async () => {
   commands.current = 'unrelated.desktop';
   for (const base of [config, applications]) {
      for (const file of ['mimeapps.list', 'gnome-mimeapps.list', 'kde-mimeapps.list']) {
         await writeFile(
            join(base, file),
            [
               '# user preferences',
               '[Default Applications]',
               `${mime}=${own};unrelated.desktop;`,
               'x-scheme-handler/modelsaber=models.desktop;',
               '[Added Associations]',
               `${mime}=${own};unrelated.desktop;`,
               '[Removed Associations]',
               `${mime}=blocked.desktop;`,
               '[Custom Section]',
               'keep=value',
               ''
            ].join('\n')
         );
      }
   }
   expect(await remove()).toMatchObject({ status: 'ok' });
   for (const base of [config, applications]) {
      for (const file of ['mimeapps.list', 'gnome-mimeapps.list', 'kde-mimeapps.list']) {
         const contents = await readFile(join(base, file), 'utf8');
         expect(contents).toContain(`${mime}=unrelated.desktop;`);
         expect(contents).toContain('x-scheme-handler/modelsaber=models.desktop;');
         expect(contents).toContain('# user preferences');
         expect(contents).toContain('[Custom Section]\nkeep=value');
         expect(contents).toContain('blocked.desktop;');
         const defaults = contents.split('[Default Applications]')[1]?.split('[')[0];
         expect(defaults).not.toContain(own);
         if (file === 'mimeapps.list') expect(contents).not.toContain(own);
      }
   }
   expect(commands.calls).toEqual([]);
});

test('repeated removal succeeds without rewriting configuration or restoring again', async () => {
   expect(await remove()).toMatchObject({ status: 'ok' });
   const first = await readFile(join(config, 'mimeapps.list'), 'utf8');
   const calls = [...commands.calls];
   const writes = vi.mocked(writeFileAtomic).mock.calls.length;
   expect(await remove()).toMatchObject({ status: 'ok' });
   expect(await readFile(join(config, 'mimeapps.list'), 'utf8')).toBe(first);
   expect(commands.calls).toEqual(calls);
   expect(vi.mocked(writeFileAtomic).mock.calls).toHaveLength(writes);
});

test('missing user configuration is created and native handlers are excluded', async () => {
   await rm(config, { recursive: true });
   commands.current = '';
   expect(await remove()).toMatchObject({ status: 'ok' });
   expect(await readFile(join(config, 'mimeapps.list'), 'utf8')).toContain(`${mime}=com.scoresaber.encore.desktop;encore.desktop;`);
   expect(existsSync(commands.entry)).toBe(false);
});

test('returns an error when writing configuration fails and retains the desktop entry', async () => {
   vi.mocked(writeFileAtomic).mockResolvedValueOnce(Result.err(createProblem('filesystem.operation.write-failed', { path: config })));
   const result = await remove();
   expect(result).toMatchObject({ status: 'error' });
   expect(existsSync(commands.entry)).toBe(true);
   expect(commands.calls).toEqual([]);
});

test('returns an error when restoring the previous handler command fails', async () => {
   commands.fail = true;
   expect(await remove()).toMatchObject({ status: 'error' });
   expect(commands.calls).toContainEqual(['default', 'previous.desktop', mime]);
   expect(existsSync(commands.entry)).toBe(true);
});

test('returns an error when the desktop still selects a native Encore handler', async () => {
   commands.current = 'com.scoresaber.encore.desktop';
   expect(await remove()).toMatchObject({ status: 'error' });
});

test('retains restoration metadata when the desktop command succeeds without changing the handler', async () => {
   commands.unchanged = true;
   expect(await remove()).toMatchObject({ status: 'error' });
   expect(existsSync(commands.entry)).toBe(true);
});

test('removes Encore even when the saved previous handler has been uninstalled', async () => {
   await rm(join(applications, 'previous.desktop'));
   expect(await remove()).toMatchObject({ status: 'ok' });
   expect(existsSync(commands.entry)).toBe(false);
   expect(commands.calls).toEqual([]);
});

test.each(['/encore-test-missing-program', 'encore-test-missing-program'])(
   'removes Encore without restoring a previous handler whose TryExec is unavailable: %s',
   async (tryExec) => {
      await writeFile(join(applications, 'previous.desktop'), `[Desktop Entry]\nType=Application\nExec=/usr/bin/true %u\nTryExec=${tryExec}\n`);
      expect(await remove()).toMatchObject({ status: 'ok' });
      expect(existsSync(commands.entry)).toBe(false);
      expect(commands.calls).toEqual([]);
   }
);

test.each(['/usr/bin/true', 'true'])('restores a previous handler whose TryExec is executable: %s', async (tryExec) => {
   await writeFile(join(applications, 'previous.desktop'), `[Desktop Entry]\nType=Application\nExec=/usr/bin/true %u\nTryExec=${tryExec}\n`);
   expect(await remove()).toMatchObject({ status: 'ok' });
   expect(commands.calls).toContainEqual(['default', 'previous.desktop', mime]);
   expect(existsSync(commands.entry)).toBe(false);
});
