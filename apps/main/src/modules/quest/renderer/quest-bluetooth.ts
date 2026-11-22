/// <reference types="web-bluetooth" />

import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import { companionCharacteristicUuid, companionServiceUuid } from '@/modules/quest/contract';
import type { CompanionTransport } from '@/modules/quest/renderer/quest-companion';

type BluetoothHeadset = { name: string; transport: CompanionTransport; disconnect: () => void };

export async function connectBluetoothHeadset(recover: () => Promise<boolean>): Promise<Result<BluetoothHeadset, Problem>> {
   const device = await Result.tryPromise({
      try: () => navigator.bluetooth.requestDevice({ filters: [{ services: [companionServiceUuid] }] }),
      catch: (cause) => createProblem(isNotFound(cause) ? 'quest.bluetooth.not-chosen' : 'quest.bluetooth.unavailable')
   });
   if (Result.isError(device)) return Result.err(device.error);
   const gatt = device.value.gatt;
   if (!gatt) return Result.err(createProblem('quest.bluetooth.unavailable'));
   const server = await Result.tryPromise({ try: () => gatt.connect(), catch: () => createProblem('quest.bluetooth.unavailable') });
   if (Result.isError(server)) return Result.err(server.error);

   const primaryService = () => Result.tryPromise({ try: () => server.value.getPrimaryService(companionServiceUuid), catch: (cause) => cause });
   const found = await primaryService();
   const service = Result.isError(found) && isNotFound(found.error) && (await recover()) ? await primaryService() : found;
   const characteristic = await service.andThenAsync((opened) =>
      Result.tryPromise({ try: () => opened.getCharacteristic(companionCharacteristicUuid), catch: (cause) => cause })
   );
   if (Result.isError(characteristic)) {
      server.value.disconnect();
      return Result.err(createProblem('quest.bluetooth.unavailable'));
   }

   return Result.ok({
      name: device.value.name ?? 'Meta Quest',
      transport: {
         write: (chunk) => characteristic.value.writeValueWithResponse(Uint8Array.from(chunk)),
         read: async () => {
            const value = await characteristic.value.readValue();
            return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
         }
      },
      disconnect: () => server.value.disconnect()
   });
}

function isNotFound(cause: unknown) {
   return cause instanceof DOMException && cause.name === 'NotFoundError';
}
