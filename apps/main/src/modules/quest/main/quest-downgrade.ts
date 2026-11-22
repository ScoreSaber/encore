import { Result } from 'better-result';
import { z } from 'zod';

import { quoteShellArg } from '@/lib/android/adb';
import { downloadContent } from '@/lib/content/content-download';
import { createProblem, type Problem } from '@/lib/errors';
import { removeQuietly } from '@/lib/filesystem/path';
import { beatSaberPackageId } from '@/modules/quest/contract';
import type { QuestConnection } from '@/modules/quest/main/quest-device-service';
import { readBackupState } from '@/modules/quest/main/quest-patch-backup';
import { questDowngradeAgentDir, questObbDir } from '@/modules/quest/main/quest-paths';
import type { QuestVersionPlan } from '@/modules/quest/main/quest-version-catalog';

import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const agentUrl = 'https://mbf.bsquest.xyz/mbf-agent';
const requestTimeoutMs = 45 * 60_000;
const responseSchema = z.discriminatedUnion('type', [
   z.object({ type: z.literal('LogMsg'), message: z.string(), level: z.enum(['Error', 'Warn', 'Info', 'Debug', 'Trace']) }),
   z.object({
      type: z.literal('DowngradedManifest'),
      manifest_xml: z
         .string()
         .min(1)
         .max(2 * 1024 * 1024)
   }),
   z.object({ type: z.literal('Patched'), did_remove_dlc: z.boolean(), installed_mods: z.array(z.object({ id: z.string().min(1) })) })
]);

type AgentRequest =
   | { type: 'GetDowngradedManifest'; version: string }
   | {
        type: 'Patch';
        downgrade_to: string;
        manifest_mod: string;
        remodding: true;
        allow_no_core_mods: false;
        device_pre_v51: boolean;
        override_core_mod_url: null;
        vr_splash_path: null;
     };
type AgentResponse = z.infer<typeof responseSchema>;
type QuestDowngradeResources = { agent: (signal: AbortSignal) => Promise<Result<{ path: string; sha256: string }, Problem>> };
export type QuestDowngrade = ReturnType<typeof createQuestDowngrade>;

export function createQuestDowngrade(options: { cacheRoot: string; resources?: QuestDowngradeResources }) {
   const resources = options.resources ?? createQuestDowngradeResources(options.cacheRoot);

   function prepare(connection: QuestConnection, plan: QuestVersionPlan, signal: AbortSignal) {
      const { client, serial } = connection;

      return Result.gen(async function* () {
         if (!plan.downgrade || plan.diffSequence.length === 0) return Result.err(createProblem('quest.downgrade.invalid-plan'));
         if (signal.aborted) return Result.err(createProblem('quest.downgrade.cancelled'));
         const sdk = yield* Result.await(client.sdkVersion(serial));
         if (sdk === null || sdk < 31) return Result.err(createProblem('quest.downgrade.android-unsupported'));
         const agent = yield* Result.await(resources.agent(signal));
         const agentPath = `${questDowngradeAgentDir}/${agent.sha256}/agent`;
         yield* Result.await(client.mkdirs(serial, agentPath.slice(0, agentPath.lastIndexOf('/'))));
         const pushed = await client.push(serial, agent.path, agentPath);
         await removeQuietly(agent.path);
         if (Result.isError(pushed)) return Result.err(pushed.error);
         const digest = yield* Result.await(client.shell(serial, `sha256sum ${quoteShellArg(agentPath)}`));
         if (digest.trim().split(/\s+/)[0]?.toLowerCase() !== agent.sha256) return Result.err(createProblem('quest.downgrade.agent-checksum'));
         yield* Result.await(client.shell(serial, `chmod 700 ${quoteShellArg(agentPath)}`));
         if (signal.aborted) return Result.err(createProblem('quest.downgrade.cancelled'));
         const manifest = yield* Result.await(request(connection, agentPath, { type: 'GetDowngradedManifest', version: plan.version }));
         if (manifest.type !== 'DowngradedManifest') return Result.err(createProblem('quest.downgrade.no-manifest'));
         const manifestXml = manifest.manifest_xml;

         const run = () =>
            Result.gen(async function* () {
               const backup = yield* Result.await(readBackupState(connection));
               if (!backup.complete || !backup.apk) return Result.err(createProblem('quest.downgrade.backup-incomplete'));
               const installedVersion = yield* Result.await(client.packageVersionName(serial, beatSaberPackageId));
               if (installedVersion !== plan.installedVersion) return Result.err(createProblem('quest.downgrade.version-changed'));
               const patched = yield* Result.await(
                  request(connection, agentPath, {
                     type: 'Patch',
                     downgrade_to: plan.version,
                     manifest_mod: manifestXml,
                     remodding: true,
                     allow_no_core_mods: false,
                     device_pre_v51: false,
                     override_core_mod_url: null,
                     vr_splash_path: null
                  })
               );
               if (patched.type !== 'Patched') return Result.err(createProblem('quest.downgrade.unfinished'));
               const version = yield* Result.await(client.packageVersionName(serial, beatSaberPackageId));
               if (version !== plan.version) return Result.err(createProblem('quest.downgrade.install-failed'));
               const lastDiff = plan.diffSequence.at(-1);
               if (!lastDiff) return Result.err(createProblem('quest.downgrade.invalid-plan'));
               for (const obb of lastDiff.obb_diffs) {
                  const path = `${questObbDir}/${obb.output_file_name}`;
                  const size = yield* Result.await(client.shell(serial, `stat -c %s ${quoteShellArg(path)}`));
                  if (Number(size.trim()) !== obb.output_size) return Result.err(createProblem('quest.downgrade.obb-incomplete'));
               }
               return Result.ok({ didRemoveDlc: patched.did_remove_dlc });
            });

         return Result.ok({ run });
      });
   }

   async function request(connection: QuestConnection, agentPath: string, input: AgentRequest): Promise<Result<AgentResponse, Problem>> {
      const { client, serial } = connection;
      const staging = await Result.tryPromise({
         try: () => mkdtemp(join(options.cacheRoot, 'request-')),
         catch: (cause) => createProblem('quest.downgrade.request-failed', { cause })
      });
      if (Result.isError(staging)) return Result.err(staging.error);
      const localPath = join(staging.value, 'request.json');
      const remotePath = `${questDowngradeAgentDir}/request-${randomUUID()}.json`;
      const output = await Result.gen(async function* () {
         yield* Result.await(
            Result.tryPromise({
               try: () =>
                  writeFile(
                     localPath,
                     `${JSON.stringify({ agent_parameters: { game_id: beatSaberPackageId, ignore_package_id: false }, ...input })}\n`,
                     {
                        mode: 0o600
                     }
                  ),
               catch: (cause) => createProblem('quest.downgrade.request-failed', { cause })
            })
         );
         yield* Result.await(client.push(serial, localPath, remotePath));
         return client.shell(serial, `${quoteShellArg(agentPath)} < ${quoteShellArg(remotePath)}`, requestTimeoutMs);
      });
      await removeQuietly(staging.value);
      await client.removePath(serial, remotePath);
      return output.andThen(parseAgentResponse);
   }

   return { prepare };
}

function createQuestDowngradeResources(cacheRoot: string): QuestDowngradeResources {
   async function agent(signal: AbortSignal) {
      const path = join(cacheRoot, `agent-${randomUUID()}`);
      const created = await Result.tryPromise({
         try: () => mkdir(cacheRoot, { recursive: true }),
         catch: (cause) => createProblem('quest.downgrade.agent-download-failed', { cause })
      });
      if (Result.isError(created)) return Result.err(created.error);
      const downloaded = await downloadContent({
         url: agentUrl,
         destinationPath: path,
         policy: { allowedHosts: ['mbf.bsquest.xyz'] },
         limits: { maxDownloadBytes: 64 * 1024 * 1024 },
         signal
      });
      if (Result.isError(downloaded)) {
         await removeQuietly(path);
         return Result.err(createProblem('quest.downgrade.agent-download-failed', { cause: downloaded.error }));
      }
      return Result.ok({ path, sha256: downloaded.value.sha256 });
   }
   return { agent };
}

function parseAgentResponse(output: string): Result<AgentResponse, Problem> {
   let response: AgentResponse | null = null;
   for (const line of output.split('\n').filter((value) => value.trim().length > 0)) {
      const parsed = Result.try({
         try: () => responseSchema.parse(JSON.parse(line)),
         catch: (cause) => createProblem('quest.downgrade.invalid-response', { cause })
      });
      if (Result.isError(parsed)) return Result.err(parsed.error);
      if (parsed.value.type === 'LogMsg') {
         if (parsed.value.level === 'Error') return Result.err(createProblem('quest.downgrade.failed', { detail: parsed.value.message }));
      } else if (response) return Result.err(createProblem('quest.downgrade.extra-response'));
      else response = parsed.value;
   }
   return response ? Result.ok(response) : Result.err(createProblem('quest.downgrade.incomplete-response'));
}
