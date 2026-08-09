export type UpdateSnapshot = {
   status: 'disabled' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
   version?: string;
   percent?: number;
   message?: string;
   reason?: 'development' | 'system-managed';
};
