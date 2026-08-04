import { Result } from 'better-result';

import type { ReceiverPairingSession } from '@/modules/receiver/contract';
import type { HttpFailure } from '@/modules/receiver/main/receiver-http';
import { createPairingCode, createReceiverToken, hashReceiverToken, receiverTokenHashesEqual } from '@/modules/receiver/main/tokens';
import type { PairedDevice } from '@/modules/settings/contract';
import type { SettingsStore } from '@/modules/settings/main/settings-store';

export const pairingTtlMs = 2 * 60 * 1_000;
export const maxSessionAttempts = 5;
export const maxAddressFailures = 10;
export const addressFailureWindowMs = 5 * 60 * 1_000;
export const addressBlockMs = 5 * 60 * 1_000;
export const lastSeenWriteIntervalMs = 60 * 1_000;
export const maxTrackedFailureAddresses = 256;

type PendingPairing = ReceiverPairingSession & {
   codeHash: string;
   timer: ReturnType<typeof setTimeout>;
};

type AddressFailures = {
   count: number;
   firstFailedAt: number;
   blockedUntil: number;
};

type PairingOptions = {
   settingsStore: SettingsStore;
   onSessionChanged: (session: ReceiverPairingSession | null) => void;
   now?: () => number;
};

export type ReceiverPairingController = ReturnType<typeof createReceiverPairingController>;

export function createReceiverPairingController(options: PairingOptions) {
   const now = options.now ?? (() => Date.now());
   const addressFailures = new Map<string, AddressFailures>();
   const lastSeenUpdates = new Map<string, Promise<boolean>>();
   let pending: PendingPairing | null = null;

   function start() {
      clear();

      const code = createPairingCode();
      const session: ReceiverPairingSession = {
         code,
         expiresAt: new Date(now() + pairingTtlMs).toISOString(),
         attemptsRemaining: maxSessionAttempts
      };

      pending = {
         ...session,
         codeHash: hashReceiverToken(code),
         timer: setTimeout(() => {
            clear();
         }, pairingTtlMs)
      };

      options.onSessionChanged(session);
      return session;
   }

   function clear() {
      if (pending) {
         clearTimeout(pending.timer);
         pending = null;
         options.onSessionChanged(null);
      }
   }

   function getSession(): ReceiverPairingSession | null {
      if (!pending) return null;

      return {
         code: pending.code,
         expiresAt: pending.expiresAt,
         attemptsRemaining: pending.attemptsRemaining
      };
   }

   async function complete(input: { code: string; deviceName: string; address: string }) {
      const blocked = checkAddressBlock(input.address);
      if (blocked) return Result.err<{ token: string; device: PairedDevice }, HttpFailure>(blocked);

      if (!pending || Date.parse(pending.expiresAt) <= now()) {
         clear();
         return Result.err<{ token: string; device: PairedDevice }, HttpFailure>({
            status: 403,
            code: 'receiver.pairing.expired',
            message: 'Pairing code is not active'
         });
      }

      if (!receiverTokenHashesEqual(hashReceiverToken(input.code), pending.codeHash)) {
         recordFailure(input.address);
         pending.attemptsRemaining -= 1;

         if (pending.attemptsRemaining <= 0) {
            clear();
            return Result.err<{ token: string; device: PairedDevice }, HttpFailure>({
               status: 429,
               code: 'receiver.pairing.attempts-exhausted',
               message: 'Too many failed pairing attempts. Start pairing again on the receiver'
            });
         }

         options.onSessionChanged(getSession());
         return Result.err<{ token: string; device: PairedDevice }, HttpFailure>({
            status: 403,
            code: 'receiver.pairing.invalid',
            message: `Pairing code is invalid. ${pending.attemptsRemaining} attempts remaining`
         });
      }

      const token = createReceiverToken();
      const pairedAt = new Date(now()).toISOString();
      const device: PairedDevice = {
         id: `device_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
         name: input.deviceName,
         tokenHash: hashReceiverToken(token),
         pairedAt,
         lastSeenAt: pairedAt
      };

      const written = await options.settingsStore.updateAppSettings((current) => ({
         receiver: {
            pairedDevices: [...current.receiver.pairedDevices, device]
         }
      }));

      if (!written.ok) {
         return Result.err<{ token: string; device: PairedDevice }, HttpFailure>({
            status: 500,
            code: written.error.code,
            message: 'Pairing could not be saved'
         });
      }

      addressFailures.delete(input.address);
      clear();

      return Result.ok<{ token: string; device: PairedDevice }, HttpFailure>({ token, device });
   }

   async function authenticate(token: string) {
      const tokenHash = hashReceiverToken(token);
      const snapshot = await options.settingsStore.getSnapshot();
      const device = snapshot.app.receiver.pairedDevices.find((candidate) => receiverTokenHashesEqual(tokenHash, candidate.tokenHash));
      if (!device) return null;

      const seenAt = now();
      if (device.lastSeenAt && seenAt - Date.parse(device.lastSeenAt) < lastSeenWriteIntervalMs) return device;

      const pendingUpdate = lastSeenUpdates.get(device.id);
      if (pendingUpdate) return (await pendingUpdate) ? device : null;

      const update = persistLastSeen(device.id, new Date(seenAt).toISOString());
      lastSeenUpdates.set(device.id, update);
      const stillPaired = await update;
      if (lastSeenUpdates.get(device.id) === update) lastSeenUpdates.delete(device.id);

      return stillPaired ? device : null;
   }

   async function persistLastSeen(deviceId: string, seenAt: string) {
      let stillPaired = false;

      await options.settingsStore.updateAppSettings((current) => {
         stillPaired = current.receiver.pairedDevices.some((candidate) => candidate.id === deviceId);
         if (!stillPaired) return {};

         return {
            receiver: {
               pairedDevices: current.receiver.pairedDevices.map((candidate) =>
                  candidate.id === deviceId ? { ...candidate, lastSeenAt: seenAt } : candidate
               )
            }
         };
      });

      return stillPaired;
   }

   function checkAddressBlock(address: string): HttpFailure | null {
      pruneAddressFailures();
      const failures = addressFailures.get(address);
      if (!failures) return null;

      if (failures.blockedUntil > now()) {
         return {
            status: 429,
            code: 'receiver.pairing.rate-limited',
            message: 'Too many failed pairing attempts from this address. Try again later'
         };
      }

      if (failures.blockedUntil > 0) addressFailures.delete(address);
      return null;
   }

   function recordFailure(address: string) {
      const at = now();
      pruneAddressFailures(at);
      const current = addressFailures.get(address);

      if (!current || at - current.firstFailedAt > addressFailureWindowMs) {
         if (!current && addressFailures.size === maxTrackedFailureAddresses) {
            let oldestUnblocked: { address: string; failedAt: number } | undefined;

            for (const [candidateAddress, failures] of addressFailures) {
               if (failures.blockedUntil > at || (oldestUnblocked && failures.firstFailedAt >= oldestUnblocked.failedAt)) continue;

               oldestUnblocked = { address: candidateAddress, failedAt: failures.firstFailedAt };
            }

            if (!oldestUnblocked) return;
            addressFailures.delete(oldestUnblocked.address);
         }

         addressFailures.set(address, { count: 1, firstFailedAt: at, blockedUntil: 0 });
         return;
      }

      current.count += 1;
      if (current.count >= maxAddressFailures) {
         current.blockedUntil = at + addressBlockMs;
      }
   }

   function pruneAddressFailures(at = now()) {
      for (const [address, failures] of addressFailures) {
         const expired = failures.blockedUntil > 0 ? failures.blockedUntil <= at : at - failures.firstFailedAt > addressFailureWindowMs;
         if (expired) addressFailures.delete(address);
      }
   }

   return {
      start,
      clear,
      getSession,
      complete,
      authenticate
   };
}
