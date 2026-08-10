import { Result } from 'better-result';
import { PostHog } from 'posthog-node';
import { z } from 'zod';

import { causeMessage } from '@/lib/errors';
import type { TelemetryClient } from '@/modules/telemetry/main/telemetry-service';

const refreshFlagKey = 'encore-telemetry-refresh';
const refreshPayloadSchema = z.object({ generation: z.union([z.string(), z.number()]) });

export function createPostHogTelemetryClient(config: { apiKey: string; host: string }) {
   return Result.try({
      try: () =>
         new PostHog(config.apiKey, {
            host: config.host,
            disableGeoip: true,
            personProfiles: 'never',
            sendFeatureFlagEvent: false,
            enableExceptionAutocapture: false,
            flushAt: 20,
            flushInterval: 5_000,
            requestTimeout: 5_000,
            featureFlagsRequestTimeoutMs: 5_000
         }),
      catch: (cause) => ({
         message: 'failed to configure PostHog telemetry',
         detail: causeMessage(cause)
      })
   }).map(
      (posthog): TelemetryClient => ({
         capture: (event) => {
            posthog.capture({ ...event, disableGeoip: true });
         },
         getRefreshGeneration: async (distinctId) => {
            const evaluated = await Result.tryPromise({
               try: () => posthog.evaluateFlags(distinctId, { flagKeys: [refreshFlagKey], disableGeoip: true }),
               catch: () => undefined
            });
            if (Result.isError(evaluated)) return null;

            const parsed = refreshPayloadSchema.safeParse(evaluated.value.getFlagPayload(refreshFlagKey));
            return parsed.success ? String(parsed.data.generation) : null;
         },
         shutdown: async () => {
            await Result.tryPromise({
               try: () => posthog.shutdown(1_500),
               catch: () => undefined
            });
         }
      })
   );
}
