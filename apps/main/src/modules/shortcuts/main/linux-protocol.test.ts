import { Result } from 'better-result';
import { expect, onTestFinished, test, vi } from 'vite-plus/test';

import { waitFor } from '@/modules/operations/main/operation-waiting.fixture';
import {
   isLinuxProtocolRegistered,
   queryLinuxProtocolDefault,
   registerLinuxProtocols,
   unregisterLinuxProtocols
} from '@/modules/shortcuts/main/linux-protocol';

import { execFile, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

test.skipIf(process.platform !== 'linux' || Boolean(spawnSync('xdg-mime', ['--version']).error))(
   'Linux link switches restore the previous handler and can be enabled again',
   async () => {
      const root = await mkdtemp(join(tmpdir(), 'encore-protocol-check-'));
      onTestFinished(async () => {
         vi.unstubAllEnvs();
         await rm(root, { recursive: true, force: true });
      });
      for (const key of ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_DIRS', 'XDG_CONFIG_DIRS']) vi.stubEnv(key, join(root, key));
      vi.stubEnv('XDG_CURRENT_DESKTOP', '');

      const apps = join(root, 'XDG_DATA_HOME/applications');
      const config = join(root, 'XDG_CONFIG_HOME');
      await mkdir(apps, { recursive: true });
      await mkdir(config);
      for (const [id, scheme] of [
         ['other', 'beatsaver'],
         ['com.scoresaber.encore', 'encore']
      ]) {
         await writeFile(
            join(apps, `${id}.desktop`),
            `[Desktop Entry]\nType=Application\nName=${id}\nExec=/usr/bin/true %u\nMimeType=x-scheme-handler/${scheme};\n`
         );
      }
      await writeFile(
         join(config, 'mimeapps.list'),
         '[Default Applications]\nx-scheme-handler/beatsaver=other.desktop;\nx-scheme-handler/encore=com.scoresaber.encore.desktop;\n'
      );

      const schemes = ['beatsaver', 'web+bsmap'];
      expect(Result.isOk(await registerLinuxProtocols([...schemes, 'modelsaber'], ['/usr/bin/true']))).toBe(true);
      expect(await Promise.all(schemes.map((scheme) => isLinuxProtocolRegistered(scheme, false)))).toEqual([true, true]);
      expect(Result.isOk(await unregisterLinuxProtocols(schemes, () => false))).toBe(true);
      expect(await Promise.all(schemes.map((scheme) => isLinuxProtocolRegistered(scheme, false)))).toEqual([false, false]);
      expect(await isLinuxProtocolRegistered('modelsaber', false)).toBe(true);
      expect(spawnSync('xdg-mime', ['query', 'default', 'x-scheme-handler/beatsaver'], { encoding: 'utf8' }).stdout.trim()).toBe('other.desktop');

      expect(await isLinuxProtocolRegistered('encore', true)).toBe(true);
      expect(Result.isOk(await unregisterLinuxProtocols(['encore'], () => true))).toBe(true);
      expect(await isLinuxProtocolRegistered('encore', true)).toBe(false);
      expect(Result.isOk(await registerLinuxProtocols([...schemes, 'encore'], ['/usr/bin/true']))).toBe(true);
      expect(await Promise.all([...schemes, 'encore'].map((scheme) => isLinuxProtocolRegistered(scheme, true)))).toEqual([true, true, true]);
      await rm(join(apps, 'other.desktop'));
      expect(await unregisterLinuxProtocols(schemes, () => false)).toMatchObject({ status: 'ok' });
      expect(await Promise.all(schemes.map((scheme) => isLinuxProtocolRegistered(scheme, false)))).toEqual([false, false]);
   }
);

async function mockDesktop(mode = '') {
   const root = await mkdtemp(join(tmpdir(), 'encore-protocol-registration-'));
   onTestFinished(async () => {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
   });
   vi.stubEnv('XDG_DATA_HOME', join(root, 'data'));
   vi.stubEnv('XDG_CONFIG_HOME', join(root, 'config'));
   vi.stubEnv('PROTOCOL_TEST_ROOT', root);
   vi.stubEnv('PROTOCOL_TEST_MODE', mode);
   vi.stubEnv('PATH', `${root}:${process.env.PATH}`);
   await writeFile(join(root, 'handler'), 'other.desktop');
   await writeFile(
      join(root, 'gio'),
      `#!/bin/sh
[ "$PROTOCOL_TEST_MODE" = delayed ] && sleep 0.2
[ "$PROTOCOL_TEST_MODE" = fallback ] && exit 1
[ "$PROTOCOL_TEST_MODE" = unavailable ] && exit 1
printf 'Default application for %s: %s\\n' "$2" "$(cat "$PROTOCOL_TEST_ROOT/handler")"
`,
      { mode: 0o755 }
   );
   await writeFile(
      join(root, 'xdg-mime'),
      `#!/bin/sh
[ "$PROTOCOL_TEST_MODE" = unavailable ] && exit 1
if [ "$1" = query ]; then cat "$PROTOCOL_TEST_ROOT/handler"; exit 0; fi
[ "$PROTOCOL_TEST_MODE" = reject ] && exit 1
[ "$PROTOCOL_TEST_MODE" = unchanged ] && exit 0
printf '%s' "$2" > "$PROTOCOL_TEST_ROOT/handler"
`,
      { mode: 0o755 }
   );
   return root;
}

test.skipIf(process.platform !== 'linux')(
   'registration preserves the previous handler across repeated registration and escapes the launcher',
   async () => {
      const root = await mockDesktop();
      const command = ['/opt/Encore %/encore', 'a"b$`\\c'];
      expect(Result.isOk(await registerLinuxProtocols(['encore'], command))).toBe(true);
      expect(Result.isOk(await registerLinuxProtocols(['encore'], command))).toBe(true);
      const entry = await readFile(join(root, 'data/applications/com.scoresaber.encore-url-encore.desktop'), 'utf8');
      expect(entry).toContain('X-Encore-PreviousHandler=other.desktop');
      expect(entry).toContain('Exec="/opt/Encore %%/encore"');
      expect((await queryLinuxProtocolDefault('encore')).unwrap()).toBe('com.scoresaber.encore-url-encore.desktop');
   }
);

test.skipIf(process.platform !== 'linux')('query falls back to xdg-mime and respects Removed Associations', async () => {
   const root = await mockDesktop('fallback');
   expect((await queryLinuxProtocolDefault('encore')).unwrap()).toBe('other.desktop');
   await mkdir(join(root, 'config'));
   await writeFile(join(root, 'config/mimeapps.list'), '[Removed Associations]\nx-scheme-handler/encore=other.desktop;\n');
   expect((await queryLinuxProtocolDefault('encore')).unwrap()).toBe('');
});

test.skipIf(process.platform !== 'linux')(
   'registration reports invalid launcher, command, query, verification and filesystem failures as results',
   async () => {
      const root = await mockDesktop();
      const invalid = await registerLinuxProtocols(['encore'], ['/bad\nlauncher']);
      expect(Result.isError(invalid)).toBe(true);
      for (const mode of ['reject', 'unavailable', 'unchanged']) {
         vi.stubEnv('PROTOCOL_TEST_MODE', mode);
         const failed = await registerLinuxProtocols(['encore'], ['/usr/bin/true']);
         expect(Result.isError(failed)).toBe(true);
         if (Result.isError(failed)) expect(failed.error.code).toBe('shortcuts.protocol-change-failed');
      }
      vi.stubEnv('PROTOCOL_TEST_MODE', '');
      await writeFile(join(root, 'not-a-directory'), '');
      vi.stubEnv('XDG_DATA_HOME', join(root, 'not-a-directory'));
      expect(Result.isError(await registerLinuxProtocols(['encore'], ['/usr/bin/true']))).toBe(true);
   }
);

test.skipIf(process.platform !== 'linux')('desktop queries leave the event loop responsive while the desktop command is delayed', async () => {
   await mockDesktop('delayed');
   let completed = false;
   const query = queryLinuxProtocolDefault('encore').then((result) => {
      completed = true;
      return result;
   });
   await new Promise((resolve) => setTimeout(resolve, 20));
   expect(completed).toBe(false);
   expect((await query).unwrap()).toBe('other.desktop');
});

test('Flatpak cannot mutate or claim sandbox associations as host handlers', async () => {
   const root = await mockDesktop();
   vi.stubEnv('FLATPAK_ID', 'com.scoresaber.encore');
   expect(await registerLinuxProtocols(['encore'], ['/usr/bin/true'])).toMatchObject({ status: 'error' });
   expect(await unregisterLinuxProtocols(['encore'], () => false)).toMatchObject({ status: 'error' });
   expect(await queryLinuxProtocolDefault('encore')).toMatchObject({ status: 'error' });
   expect(await readFile(join(root, 'handler'), 'utf8')).toBe('other.desktop');
});

test.skipIf(process.platform !== 'linux' || Boolean(spawnSync('gio', ['version']).error))(
   'desktop Exec preserves special characters in every argument when launched by GLib',
   async () => {
      const root = await mockDesktop();
      const script = join(root, 'record args.mjs');
      const output = join(root, 'output.json');
      await writeFile(script, "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));");
      const argument = 'spaces "quotes" $dollar `backtick` \\slash %percent';
      expect(await registerLinuxProtocols(['encore'], [process.execPath, script, output, argument])).toMatchObject({ status: 'ok' });
      await promisify(execFile)('/usr/bin/gio', [
         'launch',
         join(root, 'data/applications/com.scoresaber.encore-url-encore.desktop'),
         'encore://launch?a=%2F'
      ]);
      await waitFor(async () => {
         try {
            await readFile(output);
            return true;
         } catch {
            return false;
         }
      }, 'desktop launcher output');
      expect(JSON.parse(await readFile(output, 'utf8'))).toEqual([argument, 'encore://launch?a=%2F']);
   }
);
