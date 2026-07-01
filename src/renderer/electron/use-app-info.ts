import { useQuery } from '@tanstack/react-query';

import { getEncoreApi } from '@/renderer/electron/encore-api';

export function useAppInfo() {
   return useQuery({
      queryKey: ['app-info'],
      queryFn: () => getEncoreApi().app.getInfo(),
      staleTime: Infinity
   });
}
