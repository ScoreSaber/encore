import type { EncoreApi } from '@/app/ipc/api';

declare global {
   const __ENCORE_VERSION__: string;

   interface Window {
      encore: EncoreApi;
   }
}
