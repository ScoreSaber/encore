import type { EncoreApi } from '@/ipc/api';

declare global {
   interface Window {
      encore: EncoreApi;
   }
}
