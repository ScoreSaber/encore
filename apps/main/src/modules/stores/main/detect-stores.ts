import type { StoreDetectionResult } from '@/modules/stores/contract';
import { detectOculusStore } from '@/modules/stores/main/oculus';
import { detectSteamStore } from '@/modules/stores/main/steam';
import type { TargetId } from '@/modules/targets/contract';

export async function detectOfficialStores(targetId: TargetId): Promise<StoreDetectionResult> {
   const results = await Promise.all([detectSteamStore(targetId), detectOculusStore(targetId)]);
   const stores = results.map((result) => result.store);

   return {
      platform: process.platform,
      scannedAt: new Date().toISOString(),
      stores,
      candidates: results.flatMap((result) => result.candidates),
      diagnostics: stores.flatMap((store) => store.diagnostics)
   };
}
