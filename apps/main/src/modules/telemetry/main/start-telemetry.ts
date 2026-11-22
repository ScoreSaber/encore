import { Result } from 'better-result';

import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import type { AppLogWriter } from '@/modules/support/main/app-log';
import { createPostHogTelemetryClient } from '@/modules/telemetry/main/posthog-client';
import { createTelemetryService, describeOperatingSystem } from '@/modules/telemetry/main/telemetry-service';

const defaultPostHogHost = 'https://us.i.posthog.com';

export function startTelemetry(options: {
   dataPath: string;
   appVersion: string;
   settings: SettingsStore;
   installs: InstallRegistry;
   log: AppLogWriter;
}) {
   const apiKey = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim();
   if (!apiKey) return null;

   const client = createPostHogTelemetryClient({ apiKey, host: import.meta.env.VITE_POSTHOG_HOST?.trim() || defaultPostHogHost });
   if (Result.isError(client)) {
      void options.log.warn(`${client.error.message}: ${client.error.detail}`);
      return null;
   }

   const telemetry = createTelemetryService({
      dataPath: options.dataPath,
      appVersion: options.appVersion,
      operatingSystem: describeOperatingSystem(process.platform, process.getSystemVersion()),
      platform: process.platform,
      settings: options.settings,
      installs: options.installs,
      client: client.value
   });
   void telemetry.start();

   return telemetry;
}
