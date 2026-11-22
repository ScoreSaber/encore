import { Result } from 'better-result';
import { z } from 'zod';

import { createProblem, type Problem } from '@/lib/errors';
import type { SecretStore } from '@/lib/security/secret-store';
import type { QuestOwnerSignIn } from '@/modules/quest/contract';

import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const companionClientId = '1404762258107408';
const profileAppId = '826037204154824';
const deviceSecretDocumentId = '9694957887247158';
const requestTimeoutMs = 15_000;
const verificationHosts = new Set(['auth.meta.com', 'meta.com', 'www.meta.com']);
const ownerSecretKey = 'quest.owner.device-secret';
const deviceSecretPattern = /^(?:[\da-f]{2}){16,256}$/i;

const deviceGrantSchema = z.object({
   device_code: z.string().min(1).max(6000),
   user_code: z.string().min(1).max(100),
   expires_in: z.number().positive(),
   interval: z.number().positive().optional(),
   verification_uri: z.url().optional(),
   verification_uri_complete: z.url().optional()
});
const tokenSchema = z.union([z.object({ access_token: z.string().min(1).max(6000) }), z.object({ error: z.string() })]);
const profileTokenSchema = z.object({
   data: z.object({ xfr_create_profile_token: z.object({ profile_tokens: z.array(z.object({ access_token: z.string().min(1).max(6000) })).min(1) }) })
});
const deviceSecretSchema = z.object({
   data: z.object({ viewer: z.object({ user: z.object({ device_secret: z.string().regex(deviceSecretPattern) }) }) })
});

type PendingSignIn = {
   deviceCode: string;
   userCode: string;
   verificationUrl: string;
   expiresAt: number;
   intervalMs: number;
   controller: AbortController;
};

type OwnerAuthState =
   | { status: 'idle' }
   | { status: 'starting'; controller: AbortController }
   | { status: 'waiting'; pending: PendingSignIn; polling: boolean };

export function createQuestOwnerAuth(secrets: SecretStore) {
   let state: OwnerAuthState = { status: 'idle' };
   let ownerKey: Buffer | null = null;
   let restored: Promise<void> | null = null;
   let authGeneration = 0;

   function restore() {
      restored ??= (async () => {
         const stored = await secrets.read(ownerSecretKey);
         if (Result.isError(stored)) {
            restored = null;
            return;
         }
         if (stored.value && deviceSecretPattern.test(stored.value)) ownerKey = Buffer.from(stored.value, 'hex');
      })();
      return restored;
   }

   async function post<Schema extends z.ZodType>(url: string, body: Record<string, string>, schema: Schema, signal: AbortSignal) {
      const response = await Result.tryPromise({
         try: async () => {
            const sent = await fetch(url, {
               method: 'POST',
               body: new URLSearchParams(body),
               headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
               redirect: 'error',
               signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)])
            });
            return schema.safeParse(await sent.json());
         },
         catch: (cause) => createProblem(signal.aborted ? 'quest.owner.cancelled' : 'quest.owner.unavailable', { cause })
      });
      if (Result.isError(response)) return Result.err(response.error);
      const parsed = response.value;
      return parsed.success ? Result.ok<z.output<Schema>, Problem>(parsed.data) : Result.err(createProblem('quest.owner.unexpected'));
   }

   function abortActive() {
      if (state.status === 'starting') state.controller.abort();
      else if (state.status === 'waiting') state.pending.controller.abort();
      state = { status: 'idle' };
   }

   async function start(): Promise<Result<QuestOwnerSignIn, Problem>> {
      abortActive();
      const controller = new AbortController();
      state = { status: 'starting', controller };

      const grant = await post(
         'https://auth.meta.com/oidc/device/authorization/',
         { client_id: companionClientId },
         deviceGrantSchema,
         controller.signal
      );
      if (state.status !== 'starting' || state.controller !== controller) {
         return Result.err(createProblem('quest.owner.cancelled'));
      }
      if (Result.isError(grant)) {
         state = { status: 'idle' };
         return Result.err(grant.error);
      }

      const verificationUrl = new URL(grant.value.verification_uri_complete ?? grant.value.verification_uri ?? 'https://meta.com/device');
      if (verificationUrl.protocol !== 'https:' || !verificationHosts.has(verificationUrl.hostname)) {
         state = { status: 'idle' };
         return Result.err(createProblem('quest.owner.unexpected-link'));
      }
      const pending: PendingSignIn = {
         deviceCode: grant.value.device_code,
         userCode: grant.value.user_code,
         verificationUrl: verificationUrl.toString(),
         expiresAt: Date.now() + Math.min(grant.value.expires_in, 900) * 1000,
         intervalMs: Math.min(Math.max(grant.value.interval ?? 5, 1), 30) * 1000,
         controller
      };
      state = { status: 'waiting', pending, polling: false };
      return Result.ok({ userCode: pending.userCode, verificationUrl: pending.verificationUrl, expiresAt: pending.expiresAt });
   }

   async function wait(): Promise<Result<null, Problem>> {
      if (state.status !== 'waiting' || state.polling) return Result.err(createProblem('quest.owner.expired'));
      const current = state.pending;
      state = { status: 'waiting', pending: current, polling: true };
      const { signal } = current.controller;
      const startGeneration = authGeneration;
      const clearCurrent = () => {
         if (state.status === 'waiting' && state.pending === current) state = { status: 'idle' };
      };

      while (Date.now() < current.expiresAt && !signal.aborted) {
         if (Result.isError(await Result.tryPromise(() => delay(current.intervalMs, undefined, { signal })))) break;
         const token = await post(
            'https://auth.meta.com/oidc/device/token/',
            { client_id: companionClientId, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: current.deviceCode },
            tokenSchema,
            signal
         );
         if (Result.isError(token)) {
            clearCurrent();
            return Result.err(token.error);
         }
         if ('error' in token.value) {
            if (token.value.error === 'authorization_pending') continue;
            if (token.value.error === 'slow_down') {
               current.intervalMs = Math.min(current.intervalMs + 5000, 30_000);
               continue;
            }
            clearCurrent();
            return Result.err(createProblem(token.value.error === 'access_denied' ? 'quest.owner.declined' : 'quest.owner.expired'));
         }

         const accessToken = token.value.access_token;
         return Result.gen(async function* () {
            const profile = yield* Result.await(
               post(
                  'https://meta.graph.meta.com/graphql',
                  {
                     access_token: accessToken,
                     doc: 'mutation FRLNuxCreateProfileTokenMutation($input: XFRCreateProfileTokenData!) { xfr_create_profile_token(data: $input) { profile_tokens { profile_id, access_token } } }',
                     variables: JSON.stringify({ input: { app_id: profileAppId, client_mutation_id: randomUUID() } })
                  },
                  profileTokenSchema,
                  signal
               )
            );
            const [profileToken] = profile.data.xfr_create_profile_token.profile_tokens;
            if (!profileToken) {
               clearCurrent();
               return Result.err(createProblem('quest.owner.unexpected'));
            }

            const secret = yield* (
               await post(
                  'https://graph.oculus.com/graphql',
                  { access_token: profileToken.access_token, doc_id: deviceSecretDocumentId, variables: '{}' },
                  deviceSecretSchema,
                  signal
               )
            ).mapError((error) => (error.code === 'quest.owner.unexpected' ? createProblem('quest.owner.no-headset-access') : error));

            clearCurrent();
            await restore();
            if (signal.aborted || authGeneration !== startGeneration) return Result.err(createProblem('quest.owner.cancelled'));

            const deviceSecret = secret.data.viewer.user.device_secret;
            yield* (await secrets.write(ownerSecretKey, deviceSecret)).mapError((cause) => createProblem('quest.owner.not-saved', { cause }));
            if (signal.aborted || authGeneration !== startGeneration) {
               await secrets.remove(ownerSecretKey);
               return Result.err(createProblem('quest.owner.cancelled'));
            }
            ownerKey = Buffer.from(deviceSecret, 'hex');
            return Result.ok(null);
         });
      }
      clearCurrent();
      return Result.err(createProblem(signal.aborted ? 'quest.owner.cancelled' : 'quest.owner.expired'));
   }

   function cancel() {
      abortActive();
   }

   async function signedIn() {
      await restore();
      return ownerKey !== null;
   }

   async function signOut() {
      authGeneration += 1;
      abortActive();
      await restore();
      ownerKey?.fill(0);
      ownerKey = null;
      await secrets.remove(ownerSecretKey);
   }

   async function prove(challenge: number[]): Promise<Result<number[], Problem>> {
      await restore();
      if (!ownerKey) return Result.err(createProblem('quest.owner.expired'));
      return Result.ok([...createHmac('sha256', ownerKey).update(Uint8Array.from(challenge)).digest()]);
   }

   return {
      start,
      wait,
      cancel,
      signedIn,
      signOut,
      prove,
      verificationUrl: () => (state.status === 'waiting' ? state.pending.verificationUrl : null)
   };
}
