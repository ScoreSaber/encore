import { useCallback, useEffect, useState } from 'react';

import { getEncoreApi } from '@/renderer/electron/encore-api';
import type { UpdateSnapshot } from '@/shared/ipc/modules/update';

const initialUpdate: UpdateSnapshot = {
   status: 'idle'
};

export function useAppUpdate() {
   const [update, setUpdate] = useState(initialUpdate);

   useEffect(() => {
      const api = getEncoreApi();
      let disposed = false;

      void api.update.getSnapshot().then((snapshot) => {
         if (!disposed) setUpdate(snapshot);
      });

      const unsubscribe = api.update.onStatus((snapshot) => {
         if (!disposed) setUpdate(snapshot);
      });

      return () => {
         disposed = true;
         unsubscribe();
      };
   }, []);

   const checkForUpdates = useCallback(() => {
      void getEncoreApi().update.checkForUpdates().then(setUpdate);
   }, []);

   const installUpdate = useCallback(() => {
      void getEncoreApi().update.installDownloaded().then(setUpdate);
   }, []);

   return {
      update,
      checkForUpdates,
      installUpdate
   };
}
