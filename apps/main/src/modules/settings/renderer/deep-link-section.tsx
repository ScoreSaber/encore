import { useMutation, useQuery, useQueryClient, type DataTag, type QueryKey, type UndefinedInitialDataOptions } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuCheckboxItem,
   DropdownMenuContent,
   DropdownMenuSeparator,
   DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

import type { IpcResult } from '@/ipc/core';
import { mapLinkStateQueryOptions } from '@/modules/maps/renderer/map-queries';
import { modelLinkStateQueryOptions } from '@/modules/models/renderer/model-queries';
import { playlistLinkStateQueryOptions } from '@/modules/playlists/renderer/playlist-queries';
import { SettingsRow, SettingsSection } from '@/modules/settings/renderer/settings-layout';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import { contentLinkDestinationName, findContentLinkDestination } from '@/modules/shared-content/renderer/content-link-destinations';
import { useContentLinkDestinations } from '@/modules/shared-content/renderer/use-content-link';
import { shortcutStateQueryOptions } from '@/modules/shortcuts/renderer/use-install-shortcuts';
import { useTargets } from '@/modules/targets/renderer/use-targets';
import { unwrapIpc } from '@/renderer/ipc-result';
import { type apiKey, useSnapshotMutation } from '@/renderer/query/api-query';

type ProtocolState = { registered: boolean; canUnregister: boolean };

export function DeepLinkSection({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings.deepLinks');
   const { targets } = useTargets();
   const supportsMaps = targets.some((target) => target.status === 'ready' && target.capabilities.includes('manage-maps'));
   const supportsModels = targets.some((target) => target.status === 'ready' && target.capabilities.includes('manage-models'));
   const supportsPlaylists = targets.some((target) => target.status === 'ready' && target.capabilities.includes('manage-playlists'));
   const supportsDownloads = supportsMaps || supportsModels || supportsPlaylists;

   return (
      <>
         <SettingsSection title={t('protocolsTitle')}>
            <AppLinkRow disabled={disabled} />
            {supportsMaps ? <MapLinkRow disabled={disabled} /> : null}
            {supportsModels ? <ModelLinkRow disabled={disabled} /> : null}
            {supportsPlaylists ? <PlaylistLinkRow disabled={disabled} /> : null}
         </SettingsSection>

         <SettingsSection title={t('handlingTitle')}>
            <LaunchLinkHandlingRow disabled={disabled} />
            {supportsDownloads ? <DownloadLinkDestinationRow disabled={disabled} /> : null}
         </SettingsSection>
      </>
   );
}

function AppLinkRow({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings.deepLinks');
   const queryClient = useQueryClient();
   const shortcuts = useQuery(shortcutStateQueryOptions);
   const state = shortcuts.data ?? null;
   const setRegistered = useMutation({
      mutationFn: async (registered: boolean) => unwrapIpc(await window.encore.shortcuts.setProtocolRegistered({ registered })),
      onSettled: () => queryClient.invalidateQueries({ queryKey: shortcutStateQueryOptions.queryKey })
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
      <SettingsRow
         title={t('launchHandling.title')}
         description={t('launchHandling.description')}
         htmlFor="settings-launch-links-without-asking"
         control={
            <Switch
               id="settings-launch-links-without-asking"
               checked={settings.snapshot?.app.linkHandling.launchWithoutAsking ?? false}
               disabled={disabled}
               onCheckedChange={(launchWithoutAsking) => void settings.updateApp({ linkHandling: { launchWithoutAsking } })}
            />
         }
      />
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
   const saved = settings.snapshot?.app.linkHandling.downloadInstalls ?? [];
   const resolvedSaved = saved.map((install) => ({
      install,
      destination: findContentLinkDestination(destinations, install.targetId, install.installId)
   }));
   const foundByKey = new Map<string, (typeof destinations)[number]>();
   for (const entry of resolvedSaved) {
      if (entry.destination) foundByKey.set(entry.destination.key, entry.destination);
   }
   const found = [...foundByKey.values()];
   const unavailableSaved = resolvedSaved.filter((entry) => entry.destination === null).map((entry) => entry.install);
   const selectedKeys = new Set(found.map((destination) => destination.key));
   const name = (destination: (typeof destinations)[number]) =>
      `${destination.targetName} · ${contentLinkDestinationName(destination, sharedRoots('sharedContentName'))}`;
   const save = (next: typeof destinations, preserveUnavailable = true) =>
      void settings.updateApp({
         linkHandling: {
            downloadInstalls: [
               ...next.map((destination) => ({ targetId: destination.targetId, installId: destination.installId })),
               ...(preserveUnavailable ? unavailableSaved : [])
            ]
         }
      });

   return (
      <SettingsRow
         title={t('downloadDestination.title')}
         description={
            unavailableSaved.length > 0 && loadStatus === 'ready'
               ? t('downloadDestination.unavailableDescription')
               : t('downloadDestination.description')
         }
         htmlFor="settings-download-link-destination"
         control={
            <DropdownMenu>
               <DropdownMenuTrigger asChild>
                  <Button
                     id="settings-download-link-destination"
                     type="button"
                     variant="outline"
                     size="sm"
                     disabled={disabled || loadStatus === 'loading'}
                     className="w-full justify-between font-normal sm:w-64"
                  >
                     <span className="min-w-0 truncate">
                        {found.length === 0
                           ? t('downloadDestination.askEveryTime')
                           : found.length === 1 && found[0]
                             ? name(found[0])
                             : t('downloadDestination.count', { count: found.length })}
                     </span>
                     <ChevronDown className="text-muted-foreground" />
                  </Button>
               </DropdownMenuTrigger>
               <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuCheckboxItem checked={saved.length === 0} onCheckedChange={() => save([], false)}>
                     {t('downloadDestination.askEveryTime')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  {destinations.map((destination) => (
                     <DropdownMenuCheckboxItem
                        key={destination.key}
                        checked={selectedKeys.has(destination.key)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={(checked) =>
                           save(checked ? [...found, destination] : found.filter((candidate) => candidate.key !== destination.key))
                        }
                     >
                        <span className="min-w-0 truncate">{name(destination)}</span>
                     </DropdownMenuCheckboxItem>
                  ))}
               </DropdownMenuContent>
            </DropdownMenu>
         }
      />
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
   options: UndefinedInitialDataOptions<State, Error, State, ReturnType<typeof apiKey>> & { queryKey: DataTag<QueryKey, State, Error> },
   register: (registered: boolean) => Promise<IpcResult<State>>
) {
   const query = useQuery(options);
   const setRegistered = useSnapshotMutation(options.queryKey, async (registered: boolean) => unwrapIpc(await register(registered)));

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
         title={
            schemes.length > 0
               ? t('linkLabel', {
                    name: label,
                    schemes: schemes.map((scheme) => `${scheme}://`).join(', ')
                 })
               : label
         }
         htmlFor={id}
         description={failed ? t('unavailable') : permanent ? t('registeredPermanent') : undefined}
         control={
            <Switch id={id} checked={state?.registered ?? false} disabled={disabled || !state || busy || permanent} onCheckedChange={onChange} />
         }
      />
   );
}
