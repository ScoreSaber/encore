import { Result } from 'better-result';
import { expect, test } from 'vite-plus/test';

import { waitFor } from '@/modules/operations/main/operation-waiting.fixture';
import { createQuestHeadsets } from '@/modules/quest/main/quest-headsets';
import type { Target, TargetEvent } from '@/modules/targets/contract';

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const headset = (id: string, extra: Partial<Target> = {}): Target => ({
   id,
   kind: 'quest',
   name: 'Quest 3',
   status: 'ready',
   capabilities: ['manage-mods'],
   ...extra
});

function source(initial: Target[]) {
   let targets = initial;
   const listeners = new Set<(event: TargetEvent) => void>();
   return {
      listTargets: () => targets,
      subscribe: (listener: (event: TargetEvent) => void) => {
         listeners.add(listener);
         return () => listeners.delete(listener);
      },
      set(next: Target[], event: TargetEvent) {
         targets = next;
         for (const listener of listeners) listener(event);
      }
   };
}

test('one entry per headset, routed remote then USB then Wi-Fi, remembered offline and hidden once forgotten until plugged in again', async () => {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-headsets-'));
   const wifi = headset('quest:SERIAL', { address: '192.168.1.150:5555' });
   const relayed = headset('remote_abc/quest:SERIAL', { via: 'zhu' });
   const local = source([wifi]);
   const remote = source([headset('remote_abc', { kind: 'remote', name: 'zhu' }), relayed]);
   const headsets = createQuestHeadsets({ dataPath, local, remote, reconnect: async () => undefined, disableWireless: async () => Result.ok() });

   expect(headsets.listTargets()).toEqual([expect.objectContaining({ id: 'quest:SERIAL', connection: 'remote', via: 'zhu' })]);
   expect(headsets.route('quest:SERIAL')).toEqual({ targetId: relayed.id, local: false });
   expect(headsets.headsetFor('quest:SERIAL')).toBeNull();

   remote.set([], { type: 'target-removed', targetId: relayed.id });
   expect(headsets.route('quest:SERIAL')).toEqual({ targetId: 'quest:SERIAL', local: true });
   expect(headsets.listTargets()[0]).toMatchObject({ connection: 'wifi' });

   await waitFor(async () => (await readFile(join(dataPath, 'quest-headsets.json'), 'utf8').catch(() => '')).includes('wifi'), 'headset remembered');
   local.set([], { type: 'target-removed', targetId: 'quest:SERIAL' });
   expect(headsets.listTargets()).toEqual([
      expect.objectContaining({ id: 'quest:SERIAL', status: 'disconnected', connection: 'wifi', capabilities: [] })
   ]);
   expect(headsets.route('quest:SERIAL')).toBeNull();

   (await headsets.forget('quest:SERIAL')).unwrap();
   expect(headsets.listTargets()).toEqual([]);

   local.set([wifi], { type: 'target-updated', target: wifi });
   expect(headsets.listTargets()).toEqual([]);

   headsets.accept();
   expect(headsets.listTargets()).toEqual([expect.objectContaining({ id: 'quest:SERIAL', status: 'ready' })]);

   (await headsets.forget('quest:SERIAL')).unwrap();
   expect(headsets.listTargets()).toEqual([]);
   const usb = headset('quest:SERIAL');
   local.set([usb], { type: 'target-updated', target: usb });
   expect(headsets.listTargets()).toEqual([expect.objectContaining({ id: 'quest:SERIAL', connection: 'usb' })]);

   (await headsets.forget('quest:SERIAL')).unwrap();
   local.set([usb], { type: 'target-updated', target: usb });
   expect(headsets.listTargets()).toEqual([]);
   local.set([], { type: 'target-removed', targetId: 'quest:SERIAL' });
   local.set([usb], { type: 'target-updated', target: usb });
   expect(headsets.listTargets()).toEqual([expect.objectContaining({ id: 'quest:SERIAL', connection: 'usb' })]);
   headsets.dispose();
   await rm(dataPath, { recursive: true, force: true, maxRetries: 5 });
});
