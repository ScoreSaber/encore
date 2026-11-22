import type { EncoreApi } from '@/ipc/api';
import type { ScanPairingQr } from '@/ipc/mobile-bridge';

declare global {
   interface Window {
      encore: EncoreApi & {
         scanPairingQr?: ScanPairingQr;
      };
   }
}
