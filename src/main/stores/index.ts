import { detectOculusStore } from '@/main/stores/oculus';
import { detectSteamStore } from '@/main/stores/steam';
import type { InstallSummary, StoreDetectionSnapshot, StoreInstallCandidate, TargetId } from '@/shared/targets';

export async function detectOfficialStores(targetId: TargetId): Promise<StoreDetectionSnapshot> {
   const results = await Promise.all([detectSteamStore(targetId), detectOculusStore(targetId)]);
   const stores = results.map((result) => result.store);

   return {
      targetId,
      platform: process.platform,
      scannedAt: new Date().toISOString(),
      stores,
      candidates: results.flatMap((result) => result.candidates),
      diagnostics: stores.flatMap((store) => store.diagnostics)
   };
}

export function storeCandidateToInstallSummary(candidate: StoreInstallCandidate): InstallSummary {
   return {
      id: candidate.id,
      targetId: candidate.targetId,
      version: 'official',
      store: candidate.store,
      source: 'store',
      path: candidate.path,
      isReadOnly: true,
      isProtected: true,
      storeCandidate: candidate
   };
}
