import { Result } from 'better-result';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { ipcHandlerReturnSchema } from '@/ipc/core';
import { createProblem } from '@/lib/errors';
import {
   readProtocolLinkState,
   readProtocolsLinkState,
   setProtocolLinkRegistered,
   setProtocolsLinkRegistered
} from '@/modules/shortcuts/main/deep-link';
import { registerLinuxProtocols, unregisterLinuxProtocols } from '@/modules/shortcuts/main/linux-protocol';

vi.mock('electron', () => ({ app: { isPackaged: true }, BrowserWindow: {} }));
vi.mock('@/modules/shortcuts/main/linux-protocol', () => ({
   isLinuxProtocolRegistered: vi.fn(async () => true),
   registerLinuxProtocols: vi.fn(async () => Result.ok()),
   unregisterLinuxProtocols: vi.fn(async () => Result.ok())
}));

afterEach(() => {
   vi.clearAllMocks();
   vi.unstubAllEnvs();
});

test.skipIf(process.platform !== 'linux')('public setters propagate registration and removal errors through the IPC Result adapter', async () => {
   const problem = createProblem('shortcuts.protocol-change-failed', { detail: 'desktop refused the change' });
   vi.mocked(registerLinuxProtocols).mockResolvedValueOnce(Result.err(problem));
   vi.mocked(unregisterLinuxProtocols).mockResolvedValueOnce(Result.err(problem));
   expect(ipcHandlerReturnSchema.parse(await setProtocolLinkRegistered('encore', true))).toEqual({ ok: false, error: problem });
   expect(ipcHandlerReturnSchema.parse(await setProtocolsLinkRegistered(['beatsaver', 'web+bsmap'], false))).toEqual({ ok: false, error: problem });
});

test.skipIf(process.platform !== 'linux')('Flatpak state explicitly disables handler changes and explains the host desktop limitation', async () => {
   vi.stubEnv('FLATPAK_ID', 'com.scoresaber.encore');
   expect(await readProtocolLinkState('encore')).toMatchObject({ canUnregister: false, unavailableReason: expect.stringContaining('Flatpak') });
   expect(await readProtocolsLinkState(['beatsaver', 'web+bsmap'])).toMatchObject({
      canUnregister: false,
      unavailableReason: expect.stringContaining('Flatpak')
   });
});
