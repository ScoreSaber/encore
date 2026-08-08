import { useQuery, type UndefinedInitialDataOptions } from '@tanstack/react-query';
import { useTranslations } from 'use-intl';

import { Switch } from '@/components/ui/switch';

import type { IpcResult } from '@/app/ipc/core';
import { queryIpcData } from '@/app/renderer/ipc-result';
import { useSnapshotMutation } from '@/app/renderer/query/use-snapshot-mutation';
import type { IpcQueryKey } from '@/app/renderer/query/utils';
import { mapLinkStateQueryOptions } from '@/modules/maps/renderer/map-queries';
import { modelLinkStateQueryOptions } from '@/modules/models/renderer/model-queries';
import { playlistLinkStateQueryOptions } from '@/modules/playlists/renderer/playlist-queries';
import { SettingsRow, SettingsSection } from '@/modules/settings/renderer/settings-layout';
import { shortcutStateQueryOptions } from '@/modules/shortcuts/renderer/shortcut-queries';
import { useTargets } from '@/modules/targets/renderer/use-targets';

type ProtocolState = { registered: boolean; canUnregister: boolean };

type ProtocolQueryOptions<State> = UndefinedInitialDataOptions<State, Error, State, IpcQueryKey>;

export function DeepLinkSection() {
   const t = useTranslations('settings.deepLinks');
   const { targets } = useTargets();
   const supportsMaps = targets.some((target) => target.status === 'ready' && target.capabilities.includes('manage-maps'));
   const supportsModels = targets.some((target) => target.status === 'ready' && target.capabilities.includes('manage-models'));
   const supportsPlaylists = targets.some((target) => target.status === 'ready' && target.capabilities.includes('manage-playlists'));

   return (
      <SettingsSection title={t('title')}>
         <AppLinkRow />
         {supportsMaps ? <MapLinkRow /> : null}
         {supportsModels ? <ModelLinkRow /> : null}
         {supportsPlaylists ? <PlaylistLinkRow /> : null}
      </SettingsSection>
   );
}

function AppLinkRow() {
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
         onChange={(registered) => setRegistered.mutate(registered)}
      />
   );
}

function MapLinkRow() {
   const t = useTranslations('settings.deepLinks');
   const link = useLinkProtocol(mapLinkStateQueryOptions, (registered) => window.encore.maps.setMapLinkRegistered({ registered }));

   return <ProtocolRow id="settings-deep-link-maps" label={t('mapScheme')} schemes={link.state?.schemes ?? []} {...link} />;
}

function ModelLinkRow() {
   const t = useTranslations('settings.deepLinks');
   const link = useLinkProtocol(modelLinkStateQueryOptions, (registered) => window.encore.models.setModelLinkRegistered({ registered }));

   return <ProtocolRow id="settings-deep-link-models" label={t('modelScheme')} schemes={link.state ? [link.state.scheme] : []} {...link} />;
}

function PlaylistLinkRow() {
   const t = useTranslations('settings.deepLinks');
   const link = useLinkProtocol(playlistLinkStateQueryOptions, (registered) => window.encore.playlists.setPlaylistLinkRegistered({ registered }));

   return <ProtocolRow id="settings-deep-link-playlists" label={t('playlistScheme')} schemes={link.state ? [link.state.scheme] : []} {...link} />;
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
   onChange
}: {
   id: string;
   label: string;
   schemes: string[];
   state: ProtocolState | null;
   failed: boolean;
   busy: boolean;
   onChange: (registered: boolean) => void;
}) {
   const t = useTranslations('settings.deepLinks');
   const permanent = state?.registered === true && !state.canUnregister;

   return (
      <SettingsRow
         className="min-h-9 py-1.5 first:pt-1.5 last:pb-1.5"
         label={schemes.length > 0 ? t('linkLabel', { name: label, schemes: schemes.map((scheme) => `${scheme}://`).join(', ') }) : label}
         htmlFor={id}
         description={failed ? t('unavailable') : permanent ? t('registeredPermanent') : undefined}
      >
         <Switch id={id} checked={state?.registered ?? false} disabled={!state || busy || permanent} onCheckedChange={onChange} />
      </SettingsRow>
   );
}
