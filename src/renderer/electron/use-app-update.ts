import { useCallback, useEffect, useState } from 'react';

import { getEncoreApi } from '@/renderer/electron/encore-api';
import type { UpdateSnapshot } from '@/shared/ipc/contracts';

const initialUpdate: UpdateSnapshot = {
   status: 'idle'
};

export function useAppUpdate() {
   const [update, setUpdate] = useState(initialUpdate);

   useEffect(() => {
      const api = getEncoreApi();
      let disposed = false;

      void api.app.getUpdate().then((snapshot) => {
         if (!disposed) setUpdate(snapshot);
      });

      const unsubscribe = api.app.onUpdateStatus((snapshot) => {
         if (!disposed) setUpdate(snapshot);
      });

      return () => {
         disposed = true;
         unsubscribe();
      };
   }, []);

   const checkForUpdates = useCallback(() => {
      void getEncoreApi().app.checkForUpdates().then(setUpdate);
   }, []);

   const installUpdate = useCallback(() => {
      void getEncoreApi().app.installUpdate().then(setUpdate);
   }, []);

   return {
      update,
      checkForUpdates,
      installUpdate
   };
}
