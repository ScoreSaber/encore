import { useCallback, useEffect, useMemo, useState } from 'react';

import { useTranslations } from 'use-intl';

import { createLocalTargetClient } from '@/modules/targets/local-target-client';
import { createRemotePlaceholderTargetClient } from '@/modules/targets/remote-target-client';
import type { InstallSummary, Target, TargetEvent } from '@/shared/targets';

export type TargetListEntry = {
   target: Target;
   installs: InstallSummary[];
};

export type TargetsLoadStatus = 'error' | 'loading' | 'ready';

export function useTargets() {
   const t = useTranslations('targets');
   const clients = useMemo(() => [createLocalTargetClient(), createRemotePlaceholderTargetClient({ name: t('remotePlaceholderName') })], [t]);
   const [entries, setEntries] = useState<TargetListEntry[]>([]);
   const [status, setStatus] = useState<TargetsLoadStatus>('loading');
   const [reloadToken, setReloadToken] = useState(0);

   useEffect(() => {
      let disposed = false;
      setStatus('loading');

      const loads = clients.map(async (client) => {
         const targets = await client.listTargets();

         return Promise.all(
            targets.map(async (target): Promise<TargetListEntry> => {
               return {
                  target,
                  installs: await client.listInstalls(target.id)
               };
            })
         );
      });

      void Promise.all(loads).then(
         (loaded) => {
            if (disposed) return;
            setEntries(loaded.flat());
            setStatus('ready');
         },
         () => {
            if (!disposed) setStatus('error');
         }
      );

      const unsubscribes = clients.map((client) =>
         client.onEvent((event) => {
            if (!disposed) setEntries((current) => applyTargetEvent(current, event));
         })
      );

      return () => {
         disposed = true;
         for (const unsubscribe of unsubscribes) unsubscribe();
      };
   }, [clients, reloadToken]);

   const reload = useCallback(() => setReloadToken((token) => token + 1), []);

   return {
      status,
      entries,
      reload
   };
}

function applyTargetEvent(entries: TargetListEntry[], event: TargetEvent): TargetListEntry[] {
   if (event.type === 'target-updated') {
      const existing = entries.find((entry) => entry.target.id === event.target.id);
      if (!existing) {
         return [
            ...entries,
            {
               target: event.target,
               installs: []
            }
         ];
      }

      return entries.map((entry) => (entry.target.id === event.target.id ? { ...entry, target: event.target } : entry));
   }

   if (event.type === 'installs-updated') {
      return entries.map((entry) => (entry.target.id === event.targetId ? { ...entry, installs: event.installs } : entry));
   }

   return entries;
}
