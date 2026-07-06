import { useCallback, useEffect, useMemo, useState } from 'react';

import { createLocalTargetClient } from '@/modules/targets/local-target-client';
import { localTargetId, type StoreDetectionSnapshot } from '@/shared/targets';

export type StoreDetectionLoadStatus = 'error' | 'loading' | 'ready';
export type StoreDetectionScanStatus = 'idle' | 'scanning';

export function useStoreDetection() {
   const client = useMemo(() => createLocalTargetClient(), []);
   const [snapshot, setSnapshot] = useState<StoreDetectionSnapshot | null>(null);
   const [loadStatus, setLoadStatus] = useState<StoreDetectionLoadStatus>('loading');
   const [scanStatus, setScanStatus] = useState<StoreDetectionScanStatus>('idle');
   const [reloadToken, setReloadToken] = useState(0);

   useEffect(() => {
      let disposed = false;
      setLoadStatus('loading');

      void client.getStoreDetection(localTargetId).then(
         (nextSnapshot) => {
            if (disposed) return;
            setSnapshot(nextSnapshot);
            setLoadStatus('ready');
         },
         () => {
            if (!disposed) setLoadStatus('error');
         }
      );

      const unsubscribe = client.onEvent((event) => {
         if (disposed || event.type !== 'store-detection-updated' || event.targetId !== localTargetId) return;

         setSnapshot(event.snapshot);
         setLoadStatus('ready');
      });

      return () => {
         disposed = true;
         unsubscribe();
      };
   }, [client, reloadToken]);

   const reload = useCallback(() => setReloadToken((token) => token + 1), []);

   const rescan = useCallback(() => {
      setScanStatus('scanning');

      return client
         .rescanStores(localTargetId)
         .then(
            (nextSnapshot) => {
               setSnapshot(nextSnapshot);
               setLoadStatus('ready');
            },
            () => {
               setLoadStatus('error');
            }
         )
         .finally(() => setScanStatus('idle'));
   }, [client]);

   return {
      snapshot,
      loadStatus,
      scanStatus,
      reload,
      rescan
   };
}
