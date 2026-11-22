import type { SecretStore } from '@/lib/security/secret-store';
import { createModRepositoryService } from '@/modules/mods/main/repo-service';
import { createSettingsStore } from '@/modules/settings/main/settings-store';

export type MobileCore = ReturnType<typeof createMobileCore>;

export function createMobileCore(options: { dataPath: string; appVersion: string; platform: 'android' | 'darwin'; secretStore: SecretStore }) {
   const settingsStore = createSettingsStore({
      dataPath: options.dataPath,
      appVersion: options.appVersion,
      platform: options.platform,
      arch: process.arch
   });
   return { ...options, settingsStore, repositories: createModRepositoryService({ dataPath: options.dataPath, settingsStore }) };
}
