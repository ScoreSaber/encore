import { expect, test, vi } from 'vite-plus/test';

import type { AppPackaging } from '@/modules/app/contract';
import { createUpdater } from '@/modules/updates/main/updater';

import { EventEmitter } from 'node:events';

const packaging: AppPackaging = { packaged: true, format: 'nsis', selfUpdates: true, updateChecks: true, protocols: [], fileAssociations: [] };

function createEngine(download: () => Promise<string[]>) {
   return {
      checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: { version: '0.2.0' } })),
      downloadUpdate: vi.fn(download),
      quitAndInstall: vi.fn(),
      on: vi.fn()
   };
}

test('a remote update checks, downloads and installs without waiting on the caller', async () => {
   vi.useFakeTimers();
   const engine = createEngine(async () => []);
   const quit = vi.fn();
   const updater = createUpdater({ version: '0.1.0', packaging, load: async () => engine, quit, log: () => undefined });

   expect(updater.update().status).toBe('checking');
   await vi.waitFor(() => expect(updater.getState().status).toBe('downloaded'));
   expect(updater.getState().downloadedVersion).toBe('0.2.0');

   await vi.advanceTimersByTimeAsync(1_000);
   expect(quit).toHaveBeenCalledOnce();
   expect(updater.finishInstall()).toBe('started');
   expect(engine.quitAndInstall).toHaveBeenCalledWith(true, true);
   vi.useRealTimers();
});

test('a failed download stays available so it can be retried', async () => {
   const engine = createEngine(async () => Promise.reject(new Error('offline')));
   const updater = createUpdater({ version: '0.1.0', packaging, load: async () => engine, quit: vi.fn(), log: () => undefined });

   await updater.check();
   const state = await updater.download();

   expect(state).toMatchObject({ status: 'available', availableVersion: '0.2.0', errorContext: 'download', message: 'offline' });
   expect(updater.finishInstall()).toBe('idle');
});

test('an install the updater reports as failed is not treated as started', async () => {
   vi.useFakeTimers();
   const events = new EventEmitter();
   const engine = {
      ...createEngine(async () => []),
      on: events.on.bind(events),
      quitAndInstall: () => events.emit('error', new Error('installer missing'))
   };
   const updater = createUpdater({ version: '0.1.0', packaging, load: async () => engine, quit: vi.fn(), log: () => undefined });

   updater.update();
   await vi.waitFor(() => expect(updater.getState().status).toBe('downloaded'));
   await vi.advanceTimersByTimeAsync(1_000);

   expect(updater.finishInstall()).toBe('failed');
   expect(updater.getState()).toMatchObject({ errorContext: 'install', message: 'installer missing' });
   vi.useRealTimers();
});

test('dispose cancels a pending install timer, ignores post-dispose checks and keeps finishInstall ready for shutdown', async () => {
   vi.useFakeTimers();
   const engine = createEngine(async () => []);
   const quit = vi.fn();
   const updater = createUpdater({ version: '0.1.0', packaging, load: async () => engine, quit, log: () => undefined });

   updater.update();
   await vi.waitFor(() => expect(updater.getState().status).toBe('downloaded'));
   updater.dispose();

   await vi.advanceTimersByTimeAsync(2_000);
   expect(quit).not.toHaveBeenCalled();
   expect((await updater.check()).status).toBe('downloaded');
   expect(engine.checkForUpdates).toHaveBeenCalledOnce();
   expect(updater.finishInstall()).toBe('started');
   expect(updater.finishInstall()).toBe('idle');
   vi.useRealTimers();
});
