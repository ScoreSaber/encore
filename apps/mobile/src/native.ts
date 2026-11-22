import { registerPlugin } from '@capacitor/core';

import type { NativeFileChoice, ScanPairingQr } from '@/ipc/mobile-bridge';

type EncoreDevicePlugin = {
   getSecretKey: () => Promise<{ key: string; backend: 'android_keystore' | 'keychain' }>;
   chooseFile: (options: { extensions: string[] }) => Promise<NativeFileChoice>;
   copyText: (options: { text: string }) => Promise<void>;
   openLink: (options: { url: string }) => Promise<{ status: 'opened' | 'blocked' }>;
   setDaemonEnabled: (options: { enabled: boolean }) => Promise<void>;
   scanPairingQr: ScanPairingQr;
};

export const EncoreDevice = registerPlugin<EncoreDevicePlugin>('EncoreDevice');
