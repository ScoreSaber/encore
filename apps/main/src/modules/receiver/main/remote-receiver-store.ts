import { Result } from 'better-result';

import type { SecretStore } from '@/lib/security/secret-store';
import type { RemoteTargetRecord } from '@/modules/settings/contract';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import type { TargetId } from '@/modules/targets/contract';

const tokenKeyPrefix = 'receiver:remote-token:';

export type RemoteTokenState = {
   token: string | null;
   persisted: boolean;
};

export type RemoteTargetStore = ReturnType<typeof createRemoteTargetStore>;

export function createRemoteTargetStore(options: { settingsStore: SettingsStore; secretStore: SecretStore }) {
   const memoryTokens = new Map<TargetId, string>();

   async function listRecords() {
      const snapshot = await options.settingsStore.getSnapshot();
      return snapshot.app.receiver.remoteTargets;
   }

   async function saveRecord(record: RemoteTargetRecord) {
      return options.settingsStore.updateAppSettingsWith((current) => ({
         receiver: { remoteTargets: [...current.receiver.remoteTargets.filter((candidate) => candidate.id !== record.id), record] }
      }));
   }

   async function removeRecord(targetId: TargetId) {
      memoryTokens.delete(targetId);
      await options.secretStore.remove(`${tokenKeyPrefix}${targetId}`);

      return options.settingsStore.updateAppSettingsWith((current) => ({
         receiver: { remoteTargets: current.receiver.remoteTargets.filter((candidate) => candidate.id !== targetId) }
      }));
   }

   async function saveToken(targetId: TargetId, token: string): Promise<RemoteTokenState> {
      const written = await options.secretStore.write(`${tokenKeyPrefix}${targetId}`, token);
      if (Result.isError(written)) {
         memoryTokens.set(targetId, token);
         return { token, persisted: false };
      }

      memoryTokens.delete(targetId);
      return { token, persisted: true };
   }

   async function readToken(targetId: TargetId): Promise<RemoteTokenState> {
      const cached = memoryTokens.get(targetId);
      if (cached) return { token: cached, persisted: false };

      const read = await options.secretStore.read(`${tokenKeyPrefix}${targetId}`);
      if (Result.isError(read) || !read.value) return { token: null, persisted: false };

      return { token: read.value, persisted: true };
   }

   return {
      listRecords,
      saveRecord,
      removeRecord,
      saveToken,
      readToken,
      isSecureStorageAvailable: () => options.secretStore.getAvailability().available
   };
}
