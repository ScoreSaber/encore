import type { EncoreApi } from '@/shared/ipc/contracts';

declare global {
   const __ENCORE_VERSION__: string;

   interface Window {
      encore: EncoreApi;
   }
}
