import { Result } from 'better-result';

import type { QuestDaemon } from './daemon';
import type { MobileCore } from './mobile-core';

import { IpcInvokeError, ipcTransportValueSchema, type IpcTransportValue } from '@/ipc/core';
import { createIpcRouter, defineIpcHandlers, type IpcBroadcast } from '@/ipc/host';
import type { NativeFileChoice } from '@/ipc/mobile-bridge';
import { causeMessage, createProblem, type Problem } from '@/lib/errors';
import { translate } from '@/lib/messages';
import { evaluateHttpsUrl } from '@/lib/security/external-url';
import type { AppInfo } from '@/modules/app/contract';
import { appIpc } from '@/modules/app/ipc';
import { mapLinkSchemes } from '@/modules/maps/contract';
import { mapsIpc } from '@/modules/maps/ipc';
import { createBeatSaverCatalog } from '@/modules/maps/main/beatsaver-catalog';
import { fetchScoreSaberMapUrl } from '@/modules/maps/main/scoresaber/scoresaber-catalog';
import { modelLinkScheme } from '@/modules/models/contract';
import { modelsIpc } from '@/modules/models/ipc';
import type { TargetModRequest } from '@/modules/mods/api';
import { invalidModAction, type ModImportChoice } from '@/modules/mods/contract';
import { modsIpc } from '@/modules/mods/ipc';
import { createGitHubFundingService } from '@/modules/mods/main/github-funding';
import { importModUpload, uploadModToTarget } from '@/modules/mods/main/mod-upload';
import { playlistLinkScheme } from '@/modules/playlists/contract';
import { playlistsIpc } from '@/modules/playlists/ipc';
import { questIpc, questLocalIpc } from '@/modules/quest/ipc';
import { receiverIpc } from '@/modules/receiver/ipc';
import { createReceiverIpcModule } from '@/modules/receiver/main/register-ipc';
import { createRemoteReceiverClient } from '@/modules/receiver/main/remote-receiver-client';
import { createRemoteTargetStore } from '@/modules/receiver/main/remote-receiver-store';
import { settingsIpc } from '@/modules/settings/ipc';
import { encoreProtocol } from '@/modules/shortcuts/contract';
import { shortcutsIpc } from '@/modules/shortcuts/ipc';
import { supportLinkUrls } from '@/modules/support/contract';
import { supportIpc } from '@/modules/support/ipc';
import { createSupportLogService } from '@/modules/support/main/support-logs';
import { createSupportService } from '@/modules/support/main/support-service';
import { isQuestTargetId } from '@/modules/targets/contract';
import { createTargetsIpcModule } from '@/modules/targets/main/register-ipc';
import { createTargetRegistry, type TargetRegistry } from '@/modules/targets/main/target-registry';

import { rm, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

type NativeActions = {
   chooseFile: (extensions: string[]) => Promise<Result<NativeFileChoice, Problem>>;
   copyText: (text: string) => Promise<Result<void, Problem>>;
   openLink: (url: string) => Promise<Result<{ status: 'opened' | 'blocked' }, Problem>>;
};

type EventListener = (channel: string, payload: IpcTransportValue) => void;
type HostState = 'starting' | 'ready' | 'disposed';

export type EncoreIpcHost = ReturnType<typeof createEncoreIpcHost>;

export function createEncoreIpcHost(options: { core: MobileCore; quest?: QuestDaemon; platform: NodeJS.Platform; native: NativeActions }) {
   const { core, quest, native } = options;
   const { dataPath, appVersion } = core;
   const listeners = new Set<EventListener>();
   let state: HostState = 'starting';
   const isDisposed = () => state === 'disposed';
   const broadcast: IpcBroadcast = (definition, ...args) => {
      if (isDisposed()) return;
      const payload = ipcTransportValueSchema.parse(args[0]);
      for (const listener of listeners) listener(definition.channel, payload);
   };

   const remote = createRemoteReceiverClient({
      store: createRemoteTargetStore({ settingsStore: core.settingsStore, secretStore: core.secretStore })
   });
   const targets = createTargetRegistry({ remote, quest: quest?.questTarget });
   const repositories = core.repositories;
   const funding = createGitHubFundingService();
   const appInfo: AppInfo = {
      name: 'Encore',
      version: appVersion,
      release: { channel: 'alpha', version: appVersion, label: `alpha ${appVersion}`, source: 'release' },
      packaging: { packaged: true, format: 'unknown', selfUpdates: false, updateChecks: false, protocols: [], fileAssociations: [] },
      platform: options.platform,
      arch: process.arch,
      electron: '',
      chrome: '',
      node: process.versions.node
   };
   const support = createSupportService({
      logs: createSupportLogService({
         logsPath: join(dataPath, 'logs'),
         homePath: dataPath,
         registry: { get: async () => null, list: async () => ({ installs: [] }) }
      }),
      callTarget: targets.callTarget,
      homePath: dataPath,
      getAppInfo: () => appInfo
   });
   const beatSaver = createBeatSaverCatalog();

   const router = createIpcRouter([
      createTargetsIpcModule(targets, broadcast),
      quest
         ? createReceiverIpcModule(quest.receiver, remote, broadcast)
         : defineIpcHandlers(
              receiverIpc,
              {
                 getState: () => ({
                    enabled: false,
                    status: 'disabled',
                    addresses: [],
                    interfaces: [],
                    pairing: null,
                    identity: null,
                    secureStorage: core.secretStore.getAvailability(),
                    connectedDevices: []
                 }),
                 pairRemote: (request) => remote.pair(request),
                 forgetRemote: (request) => remote.forget(request.targetId)
              },
              'partial'
           ),
      defineIpcHandlers(
         appIpc,
         {
            getInfo: () => appInfo,
            copyText: async ({ text }) => {
               const copied = await native.copyText(text);
               if (Result.isError(copied)) return Promise.reject(new IpcInvokeError(copied.error));
            },
            openLink: async ({ url }) => {
               const decision = evaluateHttpsUrl(url);
               if (!decision.allowed) return { status: 'blocked' };
               const opened = await native.openLink(decision.url);
               return Result.isOk(opened) ? opened.value : { status: 'blocked' };
            }
         },
         'partial'
      ),
      defineIpcHandlers(
         settingsIpc,
         {
            getSnapshot: () => core.settingsStore.getSnapshot(),
            getProtonState: async () => ({
               supported: false,
               path: (await core.settingsStore.getSnapshot()).library.protonPath,
               validation: null,
               detectedPath: null,
               nixOs: false,
               flatpak: false
            }),
            updateApp: (request) => core.settingsStore.updateAppSettings(request),
            updateLibrary: (request) => core.settingsStore.updateLibrarySettings(request)
         },
         'partial'
      ),
      defineIpcHandlers(modsIpc, {
         getFunding: (request) => funding.get(request),
         getRepositories: () => repositories.getSnapshot(),
         refreshRepositories: () => repositories.refresh(),
         previewRepository: (request) => repositories.preview(request),
         addRepository: (request) => repositories.add(request),
         setRepositoryEnabled: (request) => repositories.setEnabled(request),
         setModSourceResolution: (request) => repositories.setSourceResolution(request),
         removeRepository: (request) => repositories.remove(request),
         takePendingRepositoryLink: () => null,
         chooseImportSource: (request) => chooseModImport(request, native, targets),
         import: (request) => importModUpload(targets, request)
      }),
      defineIpcHandlers(
         mapsIpc,
         {
            getMapLinkState: () => ({ schemes: [...mapLinkSchemes], registered: false, canUnregister: false }),
            takePendingLink: () => null,
            getMetadata: async ({ hash }) => {
               const [maps, score] = await Promise.all([beatSaver.getByHashes([hash]), fetchScoreSaberMapUrl(hash)]);
               return {
                  beatSaver: Result.isOk(maps) ? (maps.value.get(hash)?.listing ?? null) : null,
                  scoreSaberUrl: Result.isOk(score) ? score.value : null
               };
            }
         },
         'partial'
      ),
      defineIpcHandlers(
         modelsIpc,
         {
            getModelLinkState: () => ({ scheme: modelLinkScheme, registered: false, canUnregister: false }),
            takePendingLink: () => null
         },
         'partial'
      ),
      defineIpcHandlers(
         playlistsIpc,
         {
            getPlaylistLinkState: () => ({ scheme: playlistLinkScheme, registered: false, canUnregister: false }),
            takePendingLink: () => null
         },
         'partial'
      ),
      defineIpcHandlers(
         shortcutsIpc,
         {
            getState: () => ({ platform: 'other', kinds: [], protocol: { scheme: encoreProtocol, registered: false, canUnregister: false } }),
            takePendingLink: () => null
         },
         'partial'
      ),
      defineIpcHandlers(
         supportIpc,
         {
            getLogs: (request) => support.getLogs(request),
            readLog: (request) => support.readLog(request),
            previewDiagnostics: (request) => support.buildDiagnostics(request),
            openLink: async ({ id }) => {
               const opened = await native.openLink(supportLinkUrls[id]);
               return Result.isOk(opened) ? { id, status: opened.value.status } : { id, status: 'blocked', reason: 'open-failed' };
            },
            copyLog: async (request) => {
               const excerpt = await support.readLog(request);
               if (excerpt.status !== 'ready') return { status: 'failed', detail: excerpt.issue };
               const copied = await native.copyText(excerpt.text);
               return Result.isOk(copied) ? { status: 'copied' } : { status: 'failed', detail: copied.error.message };
            },
            exportDiagnostics: async (request) => {
               if (request.destination !== 'clipboard') return { status: 'failed', detail: translate('home.diagnostics.copyOnly') };
               const copied = await native.copyText(request.text);
               return Result.isOk(copied) ? { status: 'copied' } : { status: 'failed', detail: copied.error.message };
            }
         },
         'partial'
      ),
      ...(quest
         ? [
              defineIpcHandlers(
                 questIpc,
                 {
                    getConnectionStatus: () => {
                       if (!quest.devices.listTargets().some((target) => target.status === 'ready')) void quest.devices.refresh();
                       return quest.devices.getConnectionStatus();
                    }
                 },
                 'partial'
              ),
              defineIpcHandlers(questLocalIpc, {
                 openWirelessSettings: quest.openLocalWirelessSettings,
                 pair: quest.pairLocal
              })
           ]
         : [])
   ]);

   const ready = Result.tryPromise({ try: () => remote.restore(), catch: causeMessage }).then(() => {
      if (state === 'starting') state = 'ready';
   });

   async function invoke(channel: string, ...args: IpcTransportValue[]) {
      if (isDisposed()) throw new IpcInvokeError(createProblem('mobile.request-failed'));
      await ready;
      if (isDisposed()) throw new IpcInvokeError(createProblem('mobile.request-failed'));
      const result = await router.invoke(channel, args, undefined);
      if (Result.isError(result)) throw new IpcInvokeError(result.error);
      return ipcTransportValueSchema.parse(result.value);
   }

   function subscribeAll(listener: EventListener) {
      if (isDisposed()) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
   }

   function subscribe(channel: string, listener: (payload: IpcTransportValue) => void) {
      return subscribeAll((eventChannel, payload) => {
         if (eventChannel === channel) listener(payload);
      });
   }

   function dispose() {
      if (isDisposed()) return;
      state = 'disposed';
      remote.dispose();
      listeners.clear();
   }

   return { ready, invoke, subscribe, subscribeAll, dispose };
}

async function chooseModImport(request: TargetModRequest, native: NativeActions, targets: TargetRegistry): Promise<ModImportChoice> {
   const choice = await native.chooseFile(isQuestTargetId(request.targetId) ? ['qmod'] : ['dll', 'zip', 'qmod']);
   if (Result.isError(choice)) return { status: 'selected', preview: invalidModAction(request, 'inspect-failed', choice.error.message) };
   const picked = choice.value;
   if (picked.status === 'cancelled') return picked;

   try {
      return { status: 'selected', preview: await uploadModToTarget(targets, request, picked) };
   } finally {
      const removed = await Result.tryPromise({ try: () => rm(picked.path, { force: true }), catch: causeMessage });
      if (Result.isOk(removed)) await Result.tryPromise({ try: () => rmdir(dirname(picked.path)), catch: causeMessage });
   }
}
