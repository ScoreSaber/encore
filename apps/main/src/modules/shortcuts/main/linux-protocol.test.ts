import { expect, onTestFinished, test, vi } from 'vite-plus/test';

import { isLinuxProtocolRegistered, registerLinuxProtocols, unregisterLinuxProtocols } from '@/modules/shortcuts/main/linux-protocol';

import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
      await registerLinuxProtocols([...schemes, 'modelsaber'], ['/usr/bin/true']);
      expect(schemes.every((scheme) => isLinuxProtocolRegistered(scheme, false))).toBe(true);
      await unregisterLinuxProtocols(schemes, () => false);
      expect(schemes.some((scheme) => isLinuxProtocolRegistered(scheme, false))).toBe(false);
      expect(isLinuxProtocolRegistered('modelsaber', false)).toBe(true);
      expect(spawnSync('xdg-mime', ['query', 'default', 'x-scheme-handler/beatsaver'], { encoding: 'utf8' }).stdout.trim()).toBe('other.desktop');

      expect(isLinuxProtocolRegistered('encore', true)).toBe(true);
      await unregisterLinuxProtocols(['encore'], () => true);
      expect(isLinuxProtocolRegistered('encore', true)).toBe(false);
      await registerLinuxProtocols([...schemes, 'encore'], ['/usr/bin/true']);
      expect([...schemes, 'encore'].every((scheme) => isLinuxProtocolRegistered(scheme, true))).toBe(true);
   }
);
