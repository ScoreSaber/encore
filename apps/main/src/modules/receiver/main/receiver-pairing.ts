import { Result } from 'better-result';

import { createProblem } from '@/lib/errors';
import type { ReceiverPairingSession } from '@/modules/receiver/contract';
import type { HttpFailure } from '@/modules/receiver/main/receiver-http';
import { createPairingCode, createReceiverToken, hashReceiverToken, receiverTokenHashesEqual } from '@/modules/receiver/main/tokens';
import type { PairedDevice } from '@/modules/settings/contract';
import type { SettingsStore } from '@/modules/settings/main/settings-store';

import { randomUUID } from 'node:crypto';

const pairingTtlMs = 2 * 60 * 1_000;
const maxSessionAttempts = 5;
export const maxAddressFailures = 10;
const addressFailureWindowMs = 5 * 60 * 1_000;
const addressBlockMs = 5 * 60 * 1_000;
const lastSeenWriteIntervalMs = 60 * 1_000;
export const maxTrackedFailureAddresses = 256;

type PendingPairing = ReceiverPairingSession & {
   codeHash: string;
   timer: ReturnType<typeof setTimeout>;
};

type PairingState = { status: 'idle' } | { status: 'waiting'; session: PendingPairing } | { status: 'completing'; session: PendingPairing };

type AddressFailureState = { status: 'tracking'; count: number; firstFailedAt: number } | { status: 'blocked'; blockedUntil: number };

export function createReceiverPairingController(options: {
   settingsStore: SettingsStore;
   onSessionChanged: (session: ReceiverPairingSession | null) => void;
}) {
   const addressFailures = new Map<string, AddressFailureState>();
   const lastSeenUpdates = new Map<string, Promise<boolean>>();
   let pairingState: PairingState = { status: 'idle' };

   function start() {
      clear();

      const code = createPairingCode();
      const session: ReceiverPairingSession = {
         code,
         expiresAt: new Date(Date.now() + pairingTtlMs).toISOString(),
         attemptsRemaining: maxSessionAttempts
      };

      const pending: PendingPairing = {
         ...session,
         codeHash: hashReceiverToken(code),
         timer: setTimeout(() => {
            if (pairingState.status === 'waiting' && pairingState.session === pending) clear();
         }, pairingTtlMs)
      };
      pairingState = { status: 'waiting', session: pending };

      options.onSessionChanged(session);
      return session;
   }

   function clear() {
      if (pairingState.status === 'idle') return;

      clearTimeout(pairingState.session.timer);
      pairingState = { status: 'idle' };
      options.onSessionChanged(null);
   }

   function getSession(): ReceiverPairingSession | null {
      if (pairingState.status === 'idle') return null;

      return {
         code: pairingState.session.code,
         expiresAt: pairingState.session.expiresAt,
         attemptsRemaining: pairingState.session.attemptsRemaining
      };
   }

   async function complete(input: {
      code: string;
      deviceName: string;
      address: string;
   }): Promise<Result<{ token: string; device: PairedDevice }, HttpFailure>> {
      const blocked = checkAddressBlock(input.address);
      if (blocked) return Result.err(blocked);

      if (pairingState.status !== 'waiting' || Date.parse(pairingState.session.expiresAt) <= Date.now()) {
         if (pairingState.status === 'waiting') clear();
         return Result.err({ status: 403, ...createProblem('receiver.pairing.expired') });
      }

      const active = pairingState.session;
      if (!receiverTokenHashesEqual(hashReceiverToken(input.code), active.codeHash)) {
         recordFailure(input.address);
         active.attemptsRemaining -= 1;

         if (active.attemptsRemaining <= 0) {
            clear();
            return Result.err({ status: 429, ...createProblem('receiver.pairing.attempts-exhausted') });
         }

         options.onSessionChanged(getSession());
         return Result.err({ status: 403, ...createProblem('receiver.pairing.invalid', { attemptsRemaining: active.attemptsRemaining }) });
      }

      pairingState = { status: 'completing', session: active };
      const token = createReceiverToken();
      const pairedAt = new Date().toISOString();
      const device: PairedDevice = {
         id: `device_${randomUUID()}`,
         name: input.deviceName,
         tokenHash: hashReceiverToken(token),
         pairedAt,
         lastSeenAt: pairedAt
      };

      const written = await options.settingsStore.updateAppSettingsWith((current) => ({
         receiver: {
            pairedDevices: [...current.receiver.pairedDevices, device]
         }
      }));

      if (!written.ok) {
         if (pairingState.status === 'completing' && pairingState.session === active) {
            if (Date.parse(active.expiresAt) <= Date.now()) clear();
            else pairingState = { status: 'waiting', session: active };
         }
         return Result.err({ status: 500, ...createProblem('receiver.pairing.save-failed', { cause: written.error.code }) });
      }

      if (pairingState.status === 'completing' && pairingState.session === active) clear();
      addressFailures.delete(input.address);

      return Result.ok({ token, device });
   }

   async function authenticate(token: string) {
      const tokenHash = hashReceiverToken(token);
      const snapshot = await options.settingsStore.getSnapshot();
      const device = snapshot.app.receiver.pairedDevices.find((candidate) => receiverTokenHashesEqual(tokenHash, candidate.tokenHash));
      if (!device) return null;

      const seenAt = Date.now();
      if (device.lastSeenAt && seenAt - Date.parse(device.lastSeenAt) < lastSeenWriteIntervalMs) return device;

      const pendingUpdate = lastSeenUpdates.get(device.id);
      if (pendingUpdate) return (await pendingUpdate) ? device : null;

      const update = persistLastSeen(device.id, new Date(seenAt).toISOString()).finally(() => {
         if (lastSeenUpdates.get(device.id) === update) lastSeenUpdates.delete(device.id);
      });
      lastSeenUpdates.set(device.id, update);
      const stillPaired = await update;

      return stillPaired ? device : null;
   }

   async function persistLastSeen(deviceId: string, seenAt: string) {
      let stillPaired = false;

      await options.settingsStore.updateAppSettingsWith((current) => {
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
      if (!failures || failures.status !== 'blocked') return null;

      return { status: 429, ...createProblem('receiver.pairing.rate-limited') };
   }

   function recordFailure(address: string) {
      const at = Date.now();
      pruneAddressFailures(at);
      const current = addressFailures.get(address);

      if (!current || current.status === 'blocked') {
         if (!current && addressFailures.size === maxTrackedFailureAddresses) {
            let oldestUnblocked: { address: string; failedAt: number } | undefined;

            for (const [candidateAddress, failures] of addressFailures) {
               if (failures.status === 'blocked' || (oldestUnblocked && failures.firstFailedAt >= oldestUnblocked.failedAt)) continue;

               oldestUnblocked = { address: candidateAddress, failedAt: failures.firstFailedAt };
            }

            if (!oldestUnblocked) return;
            addressFailures.delete(oldestUnblocked.address);
         }

         addressFailures.set(address, { status: 'tracking', count: 1, firstFailedAt: at });
         return;
      }

      const nextCount = current.count + 1;
      if (nextCount >= maxAddressFailures) {
         addressFailures.set(address, { status: 'blocked', blockedUntil: at + addressBlockMs });
      } else {
         current.count = nextCount;
      }
   }

   function pruneAddressFailures(at = Date.now()) {
      for (const [address, failures] of addressFailures) {
         const expired = failures.status === 'blocked' ? failures.blockedUntil <= at : at - failures.firstFailedAt > addressFailureWindowMs;
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
