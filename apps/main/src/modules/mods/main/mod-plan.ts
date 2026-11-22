import semver from 'semver';

import type { ModPlanEntry, ModSummary, ModWarning } from '@/modules/mods/contract';
import { toModSummary, type ModIndex, type ModIndexEntry } from '@/modules/mods/main/mod-index';
import type { ModScan } from '@/modules/mods/main/mod-scan';
import type { OperationProgress } from '@/modules/operations/contract';

const maxDependencyDepth = 12;

export type PlannedMod = {
   entry: ModIndexEntry;
   reason: ModPlanEntry['reason'];
};

export function summarizeMods(index: ModIndex, scan: ModScan): ModSummary[] {
   return index.entries
      .map((entry) => {
         const installed = scan.installed.get(entry.modId);
         const state = installed ? (isNewerVersion(entry.version, installed.version) ? 'update-available' : 'installed') : 'available';

         return toModSummary(entry, installed?.version ?? null, state);
      })
      .sort((first, second) => first.name.localeCompare(second.name) || first.sourceName.localeCompare(second.sourceName));
}

export function buildInstallPlan(index: ModIndex, scan: ModScan, selectedIds: string[]) {
   const planned = new Map<string, PlannedMod>();
   let missingDependencies = false;

   const visit = (modId: string, reason: ModPlanEntry['reason'], depth: number) => {
      if (planned.has(modId) || depth > maxDependencyDepth) return;

      const entry = index.byModId.get(modId);
      if (!entry) return;

      planned.set(modId, { entry, reason });

      for (const dependencyId of entry.dependencies) {
         const dependency = index.byModId.get(dependencyId);
         if (!dependency) {
            missingDependencies = true;
            continue;
         }

         if (scan.installed.get(dependencyId)?.version === dependency.version) continue;

         visit(dependencyId, 'dependency', depth + 1);
      }
   };

   for (const modId of selectedIds) {
      const installed = scan.installed.get(modId);
      const entry = index.byModId.get(modId);
      visit(modId, installed && entry && isNewerVersion(entry.version, installed.version) ? 'update' : 'selected', 0);
   }

   return { mods: orderInstallPlan(planned), missingDependencies };
}

export function orderModRemovals(selectedIds: string[], dependencies: ReadonlyMap<string, string[]>) {
   const dependants = new Map<string, string[]>();
   for (const [modId, requiredIds] of dependencies) {
      for (const requiredId of requiredIds) {
         const existing = dependants.get(requiredId);
         if (existing) existing.push(modId);
         else dependants.set(requiredId, [modId]);
      }
   }

   const visited = new Set<string>();
   const ordered: string[] = [];
   const visit = (modId: string) => {
      if (visited.has(modId)) return;
      visited.add(modId);
      for (const dependantId of dependants.get(modId) ?? []) visit(dependantId);
      ordered.push(modId);
   };
   for (const modId of selectedIds) visit(modId);
   return ordered;
}

export function describeInstallPlan(plan: ReturnType<typeof buildInstallPlan>, scan: ModScan, patcherSupported: boolean) {
   const entries = plan.mods.map((planned) => planned.entry);
   const warnings: ModWarning[] = [];
   if (entries.some((entry) => entry.isBsipa)) warnings.push('bsipa-first', patcherSupported ? 'patcher-runs' : 'patcher-unsupported');
   if (plan.missingDependencies) warnings.push('missing-dependency');
   if (entries.some((entry) => scan.installed.has(entry.modId))) warnings.push('replaces-installed');
   if (entries.some((entry) => entry.sourceKind === 'unofficial')) warnings.push('unofficial-source');
   if (entries.some((entry) => entry.sourceKind === 'unofficial' && entry.claimedIdentity !== null)) warnings.push('claimed-identity');

   return {
      downloadHosts: [...new Set(entries.map((entry) => entry.downloadHost))],
      mods: plan.mods.map(toPlanEntry),
      downloadBytes: entries.every((entry) => entry.sizeBytes !== null) ? entries.reduce((total, entry) => total + (entry.sizeBytes ?? 0), 0) : null,
      warnings
   };
}

function orderInstallPlan(planned: Map<string, PlannedMod>) {
   const ordered: PlannedMod[] = [];
   const visited = new Set<string>();

   const visit = (modId: string, depth: number) => {
      const mod = planned.get(modId);
      if (!mod || visited.has(modId) || depth > maxDependencyDepth) return;

      visited.add(modId);
      for (const dependencyId of mod.entry.dependencies) {
         visit(dependencyId, depth + 1);
      }

      ordered.push(mod);
   };

   for (const [modId, mod] of planned) {
      if (mod.entry.isBsipa) visit(modId, 0);
   }

   for (const modId of planned.keys()) {
      visit(modId, 0);
   }

   return ordered;
}

function toPlanEntry(planned: PlannedMod): ModPlanEntry {
   return {
      modId: planned.entry.modId,
      sourceName: planned.entry.sourceName,
      sourceKind: planned.entry.sourceKind,
      name: planned.entry.name,
      version: planned.entry.version,
      sizeBytes: planned.entry.sizeBytes,
      reason: planned.reason,
      isBsipa: planned.entry.isBsipa
   };
}

function isNewerVersion(latest: string, installed: string) {
   const parsedLatest = semver.coerce(latest);
   const parsedInstalled = semver.coerce(installed);

   return parsedLatest && parsedInstalled ? semver.gt(parsedLatest, parsedInstalled) : latest !== installed;
}

export function progressFor(index: number, total: number, label: string, percent: number): OperationProgress {
   return {
      phase: 'installing',
      label,
      current: index,
      total,
      percent: total === 0 ? 0 : Math.min(100, Math.round(((index + percent / 100) / total) * 100)),
      unit: 'items'
   };
}
