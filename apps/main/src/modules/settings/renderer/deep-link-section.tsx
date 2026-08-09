import { useQuery, type UndefinedInitialDataOptions } from '@tanstack/react-query';
import { useTranslations } from 'use-intl';

import { contentLinkDestinationKey, contentLinkDestinationName, findContentLinkDestination } from '@/components/content/content-link-destinations';
import { useContentLinkDestinations } from '@/components/content/use-content-link';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

import type { IpcResult } from '@/ipc/core';
import { mapLinkStateQueryOptions } from '@/modules/maps/renderer/map-queries';
import { modelLinkStateQueryOptions } from '@/modules/models/renderer/model-queries';
import { playlistLinkStateQueryOptions } from '@/modules/playlists/renderer/playlist-queries';
import { SettingsRow, SettingsSection } from '@/modules/settings/renderer/settings-layout';
import { useSettings } from '@/modules/settings/renderer/settings-provider';
import { shortcutStateQueryOptions } from '@/modules/shortcuts/renderer/shortcut-queries';
import { useTargets } from '@/modules/targets/renderer/use-targets';
import { queryIpcData } from '@/renderer/ipc-result';
import { useSnapshotMutation } from '@/renderer/query/use-snapshot-mutation';
import type { IpcQueryKey } from '@/renderer/query/utils';

type ProtocolState = { registered: boolean; canUnregister: boolean };

type ProtocolQueryOptions<State> = UndefinedInitialDataOptions<State, Error, State, IpcQueryKey>;

const askEveryTimeValue = 'ask-every-time';

export function DeepLinkSection({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings.deepLinks');
   const { targets } = useTargets();
   const supportsMaps = targets.some((target) => target.status === 'ready' && target.capabilities.includes('manage-maps'));
   const supportsModels = targets.some((target) => target.status === 'ready' && target.capabilities.includes('manage-models'));
   const supportsPlaylists = targets.some((target) => target.status === 'ready' && target.capabilities.includes('manage-playlists'));
   const supportsDownloads = supportsMaps || supportsModels || supportsPlaylists;

   return (
      <SettingsSection title={t('title')}>
         <AppLinkRow disabled={disabled} />
         <LaunchLinkHandlingRow disabled={disabled} />
         {supportsMaps ? <MapLinkRow disabled={disabled} /> : null}
         {supportsModels ? <ModelLinkRow disabled={disabled} /> : null}
         {supportsPlaylists ? <PlaylistLinkRow disabled={disabled} /> : null}
         {supportsDownloads ? <DownloadLinkDestinationRow disabled={disabled} /> : null}
      </SettingsSection>
   );
}

function AppLinkRow({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings.deepLinks');
   const options = shortcutStateQueryOptions;
   const shortcuts = useQuery(options);
   const state = shortcuts.data ?? null;
   const setRegistered = useSnapshotMutation({
      queryKey: options.queryKey,
      run: (registered: boolean) => queryIpcData(() => window.encore.shortcuts.setProtocolRegistered({ registered })),
      snapshot: (protocol) => (state ? { ...state, protocol } : undefined)
   });

   return (
      <ProtocolRow
         id="settings-deep-link-protocol"
         label={t('scheme')}
         state={state?.protocol ?? null}
         schemes={state ? [state.protocol.scheme] : []}
         failed={shortcuts.isError || setRegistered.isError}
         busy={setRegistered.isPending}
         disabled={disabled}
         onChange={(registered) => setRegistered.mutate(registered)}
      />
   );
}

function LaunchLinkHandlingRow({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings.deepLinks');
   const settings = useSettings();

   return (
      <SettingsRow label={t('launchHandling.title')} description={t('launchHandling.description')} htmlFor="settings-launch-links-without-asking">
         <Switch
            id="settings-launch-links-without-asking"
            checked={settings.snapshot?.app.linkHandling.launchWithoutAsking ?? false}
            disabled={disabled}
            onCheckedChange={(launchWithoutAsking) => void settings.updateApp({ linkHandling: { launchWithoutAsking } })}
         />
      </SettingsRow>
   );
}

function MapLinkRow({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings.deepLinks');
   const link = useLinkProtocol(mapLinkStateQueryOptions, (registered) => window.encore.maps.setMapLinkRegistered({ registered }));

   return <ProtocolRow id="settings-deep-link-maps" label={t('mapScheme')} schemes={link.state?.schemes ?? []} disabled={disabled} {...link} />;
}

function DownloadLinkDestinationRow({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings.deepLinks');
   const sharedRoots = useTranslations('sharedContent.roots');
   const settings = useSettings();
   const { destinations, loadStatus } = useContentLinkDestinations(
      (target) =>
         target.capabilities.includes('manage-maps') ||
         target.capabilities.includes('manage-models') ||
         target.capabilities.includes('manage-playlists'),
      ['maps', 'playlists', 'avatars', 'notes', 'platforms', 'sabers']
   );
   const destination = settings.snapshot?.app.linkHandling.downloadInstall ?? null;
   const selectedDestination = destination ? findContentLinkDestination(destinations, destination.targetId, destination.installId) : null;
   const destinationKey = selectedDestination?.key ?? (destination ? contentLinkDestinationKey(destination.targetId, destination.installId) : null);
   const destinationAvailable = selectedDestination !== null;

   return (
      <SettingsRow
         label={t('downloadDestination.title')}
         description={
            destinationKey && !destinationAvailable && loadStatus === 'ready'
               ? t('downloadDestination.unavailableDescription')
               : t('downloadDestination.description')
         }
         htmlFor="settings-download-link-destination"
      >
         <Select
            value={destinationKey ?? askEveryTimeValue}
            disabled={disabled || loadStatus === 'loading'}
            onValueChange={(key) => {
               const destination = destinations.find((candidate) => candidate.key === key);
               void settings.updateApp({
                  linkHandling: {
                     downloadInstall: destination ? { targetId: destination.targetId, installId: destination.installId } : null
                  }
               });
            }}
         >
            <SelectTrigger id="settings-download-link-destination" className="w-full min-w-44 @md/field-group:w-64">
               <SelectValue />
            </SelectTrigger>
            <SelectContent>
               <SelectGroup>
                  <SelectItem value={askEveryTimeValue}>{t('downloadDestination.askEveryTime')}</SelectItem>
                  {destinationKey && !destinationAvailable ? (
                     <SelectItem value={destinationKey} disabled>
                        {t('downloadDestination.unavailable')}
                     </SelectItem>
                  ) : null}
                  {destinations.map((destination) => (
                     <SelectItem key={destination.key} value={destination.key}>
                        {destination.targetName} — {contentLinkDestinationName(destination, sharedRoots('sharedContentName'))}
                     </SelectItem>
                  ))}
               </SelectGroup>
            </SelectContent>
         </Select>
      </SettingsRow>
   );
}

function ModelLinkRow({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings.deepLinks');
   const link = useLinkProtocol(modelLinkStateQueryOptions, (registered) => window.encore.models.setModelLinkRegistered({ registered }));

   return (
      <ProtocolRow
         id="settings-deep-link-models"
         label={t('modelScheme')}
         schemes={link.state ? [link.state.scheme] : []}
         disabled={disabled}
         {...link}
      />
   );
}

function PlaylistLinkRow({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings.deepLinks');
   const link = useLinkProtocol(playlistLinkStateQueryOptions, (registered) => window.encore.playlists.setPlaylistLinkRegistered({ registered }));

   return (
      <ProtocolRow
         id="settings-deep-link-playlists"
         label={t('playlistScheme')}
         schemes={link.state ? [link.state.scheme] : []}
         disabled={disabled}
         {...link}
      />
   );
}

function useLinkProtocol<State extends ProtocolState>(
   options: ProtocolQueryOptions<State>,
   register: (registered: boolean) => Promise<IpcResult<State>>
) {
   const query = useQuery(options);
   const setRegistered = useSnapshotMutation({
      queryKey: options.queryKey,
      run: (registered: boolean) => queryIpcData(() => register(registered))
   });

   return {
      state: query.data ?? null,
      failed: query.isError || setRegistered.isError,
      busy: setRegistered.isPending,
      onChange: (registered: boolean) => setRegistered.mutate(registered)
   };
}

function ProtocolRow({
   id,
   label,
   schemes,
   state,
   failed,
   busy,
   disabled,
   onChange
}: {
   id: string;
   label: string;
   schemes: string[];
   state: ProtocolState | null;
   failed: boolean;
   busy: boolean;
   disabled: boolean;
   onChange: (registered: boolean) => void;
}) {
   const t = useTranslations('settings.deepLinks');
   const permanent = state?.registered === true && !state.canUnregister;

   return (
      <SettingsRow
         className="min-h-9 py-1.5 first:pt-1.5 last:pb-1.5"
         label={
            schemes.length > 0
               ? t('linkLabel', {
                    name: label,
                    schemes: schemes.map((scheme) => `${scheme}://`).join(', ')
                 })
               : label
         }
         htmlFor={id}
         description={failed ? t('unavailable') : permanent ? t('registeredPermanent') : undefined}
      >
         <Switch id={id} checked={state?.registered ?? false} disabled={disabled || !state || busy || permanent} onCheckedChange={onChange} />
      </SettingsRow>
   );
}
