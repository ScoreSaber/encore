import type { MessageEvent, SendOptions, StartOptions } from '@capawesome/capacitor-nodejs';
import { Result } from 'better-result';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { z } from 'zod';

import { initialiseMobileBridge } from './bridge';

const native = vi.hoisted(() => {
   const listeners: Array<(message: MessageEvent) => void> = [];
   return {
      listeners,
      getPlatform: vi.fn(() => 'android'),
      removeAllListeners: vi.fn(async () => {}),
      addListener: vi.fn(async (_event: string, listener: (message: MessageEvent) => void) => {
         listeners.push(listener);
         return {
            remove: async () => {
               const index = listeners.indexOf(listener);
               if (index !== -1) listeners.splice(index, 1);
            }
         };
      }),
      send: vi.fn(async (_options: SendOptions) => {}),
      start: vi.fn(async (_options?: StartOptions) => {}),
      isReady: vi.fn(async () => ({ ready: false })),
      getSecretKey: vi.fn(async () => ({ key: 'test-key', backend: 'android_keystore' })),
      chooseFile: vi.fn(async () => ({ status: 'selected', path: '/cache/encore-imports/mod.qmod', fileName: 'mod.qmod' })),
      copyText: vi.fn(async () => {}),
      openLink: vi.fn(async () => ({ status: 'opened' })),
      setDaemonEnabled: vi.fn(async () => {})
   };
});

vi.mock('@capawesome/capacitor-nodejs', () => ({
   Nodejs: native
}));

vi.mock('@capacitor/core', () => ({
   Capacitor: { getPlatform: native.getPlatform },
   registerPlugin: () => native
}));

function emit(message: MessageEvent) {
   for (const listener of native.listeners) listener(message);
}

beforeEach(() => {
   vi.stubGlobal('window', {});
   native.start.mockImplementation(async () => emit({ eventName: 'encore:bootstrap-required', args: [] }));
   native.send.mockImplementation(async (options) => {
      if (options.eventName === 'encore:bootstrap') emit({ eventName: 'encore:ready', args: [] });
   });
});

afterEach(() => {
   vi.unstubAllGlobals();
});

test('bootstraps the Quest host with its storage key and invokes generated channels with target envelopes', async () => {
   expect(Result.isOk(await initialiseMobileBridge())).toBe(true);
   expect(native.send).toHaveBeenCalledWith({ eventName: 'encore:bootstrap', args: [{ key: 'test-key', backend: 'android_keystore' }] });

   const invokeSchema = z.object({ id: z.string(), channel: z.string(), args: z.array(z.json()) });
   native.send.mockImplementation(async (options) => {
      if (options.eventName !== 'encore:invoke') return;
      const request = invokeSchema.parse(options.args?.[0]);
      emit({ eventName: 'encore:response', args: [{ id: request.id, value: { status: 'ok', targetId: 'quest:device', value: { installs: [] } } }] });
   });
   expect(await window.encore.installs.list({ targetId: 'quest:device' })).toEqual({
      status: 'ok',
      targetId: 'quest:device',
      value: { installs: [] }
   });
   expect(invokeSchema.parse(native.send.mock.lastCall?.[0]?.args?.[0])).toMatchObject({
      channel: 'installs:list',
      args: [{ targetId: 'quest:device' }]
   });
});

test('ignores duplicate bootstrap-required events and removes the boot listener once ready', async () => {
   native.listeners.length = 0;
   native.getSecretKey.mockClear();
   native.send.mockClear();
   const secretGate = Promise.withResolvers<{ key: string; backend: 'android_keystore' }>();
   native.getSecretKey.mockImplementationOnce(() => secretGate.promise);
   native.start.mockImplementation(async () => {
      emit({ eventName: 'encore:bootstrap-required', args: [] });
      emit({ eventName: 'encore:bootstrap-required', args: [] });
   });

   const initializing = initialiseMobileBridge();
   await vi.waitFor(() => expect(native.getSecretKey).toHaveBeenCalledOnce());
   secretGate.resolve({ key: 'test-key', backend: 'android_keystore' });

   expect(Result.isOk(await initializing)).toBe(true);
   expect(native.getSecretKey).toHaveBeenCalledOnce();
   expect(native.listeners).toHaveLength(1);
});
