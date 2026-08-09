import type { EncoreApi } from '@/app/ipc/api';

declare global {
   interface Window {
      encore: EncoreApi;
   }
}
