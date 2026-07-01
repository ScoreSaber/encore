import type { EncoreApi } from '@/shared/ipc/contracts';

declare global {
   interface Window {
      encore: EncoreApi;
   }
}
