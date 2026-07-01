import type { EncoreApi } from '@/shared/ipc/api';

declare global {
   const __ENCORE_VERSION__: string;

   interface Window {
      encore: EncoreApi;
   }
}
