import { Result } from 'better-result';

import { readPathInfo } from '@/lib/filesystem/path';
import type {
   ModChangesRequest,
   ModImportRequest,
   ModRemoval,
   ModSelectionRequest,
   ModUninstallRequest,
   ModWarning,
   ReadyModChangesPreview,
   ReadyModImportPreview,
   ReadyModInstallPreview,
   ReadyModUninstallPreview
} from '@/modules/mods/contract';
import type { ModContext, ModProblem } from '@/modules/mods/main/mod-context';
import { maxModArchiveBytes } from '@/modules/mods/main/mod-install';
import { modFileCandidates, modFolders, modRemovableFolders } from '@/modules/mods/main/mod-paths';
import { buildInstallPlan, describeInstallPlan, orderModRemovals, type PlannedMod } from '@/modules/mods/main/mod-plan';
import { withoutInstalledMods, type ModScan } from '@/modules/mods/main/mod-scan';

import { basename, extname, join } from 'node:path';

const importExtensions = ['.dll', '.zip'];

type InstallPlan = { preview: ReadyModInstallPreview; planned: PlannedMod[] };
type ChangesPlan = { preview: ReadyModChangesPreview; planned: PlannedMod[] };

export function planModInstall(request: ModSelectionRequest, context: ModContext, patcherSupported: boolean): Result<InstallPlan, ModProblem> {
   if (request.modIds.length === 0) return Result.err({ issue: 'nothing-selected' });

   return planInstall(request.installId, context, context.scan, request.modIds, patcherSupported);
}

export async function planModChanges(
   request: ModChangesRequest,
   context: ModContext,
   patcherSupported: boolean
): Promise<Result<ChangesPlan, ModProblem>> {
   if (request.installModIds.length === 0 || request.removeModIds.length === 0) return Result.err({ issue: 'nothing-selected' });

   const uninstall = await planModUninstall(
      { ...request, scope: 'selection', modIds: request.removeModIds, externalIds: [] },
      context,
      patcherSupported
   );
   if (Result.isError(uninstall)) return Result.err(uninstall.error);

   const removedIds = uninstall.value.mods.map((mod) => mod.modId);
   const install = planInstall(request.installId, context, withoutInstalledMods(context.scan, removedIds), request.installModIds, patcherSupported);
   if (Result.isError(install)) return Result.err(install.error);
   if (install.value.planned.some(({ entry }) => removedIds.includes(entry.modId))) return Result.err({ issue: 'conflicting-changes' });

   return Result.ok({
      preview: {
         status: 'ok',
         installId: request.installId,
         install: install.value.preview,
         uninstall: uninstall.value,
         warnings: [...new Set([...install.value.preview.warnings, ...uninstall.value.warnings])]
      },
      planned: install.value.planned
   });
}

export async function planModUninstall(
   request: ModUninstallRequest,
   context: ModContext,
   patcherSupported: boolean
): Promise<Result<ReadyModUninstallPreview, ModProblem>> {
   const { install, index, scan } = context;
   const selection = request.scope === 'all' ? [...scan.installed.keys()] : [...new Set(request.modIds.filter((id) => scan.installed.has(id)))];
   const external = request.scope === 'all' ? scan.external : scan.external.filter((file) => request.externalIds.includes(file.id));
   if (selection.length === 0 && external.length === 0 && request.scope === 'selection') return Result.err({ issue: 'nothing-selected' });

   const dependencies = new Map([...scan.installed.keys()].map((modId) => [modId, index.byModId.get(modId)?.dependencies ?? []]));
   const ordered = orderModRemovals(selection, dependencies);
   const mods = await Promise.all(ordered.map((modId) => describeRemoval(context, modId)));
   const removals = mods.filter((removal) => removal !== null);

   const warnings: ModWarning[] = [];
   if (ordered.length > selection.length) warnings.push('removes-dependants');
   if (external.length > 0 && request.scope === 'all') warnings.push('removes-external');
   if (patcherSupported && removals.some((removal) => index.byModId.get(removal.modId)?.isBsipa)) warnings.push('patcher-runs');

   return Result.ok({
      status: 'ok',
      installId: request.installId,
      installPath: install.path,
      scope: request.scope,
      mods: removals,
      external,
      folders: request.scope === 'all' ? modRemovableFolders.map((folder) => join(install.path, folder)) : [],
      fileCount: removals.reduce((total, removal) => total + removal.files.length, 0) + external.length,
      warnings
   });
}

export async function planModImport(request: ModImportRequest, context: ModContext): Promise<Result<ReadyModImportPreview, ModProblem>> {
   const extension = extname(request.sourcePath).toLowerCase();
   if (!importExtensions.includes(extension)) return Result.err({ issue: 'unsupported-file', detail: extension });

   const info = await readPathInfo(request.sourcePath);
   if (Result.isError(info) || info.value.kind !== 'file') return Result.err({ issue: 'inspect-failed', detail: request.sourcePath });
   if (info.value.sizeBytes > maxModArchiveBytes) return Result.err({ issue: 'unsupported-file', detail: 'the file is larger than Encore imports' });

   const name = request.sourceName ?? basename(request.sourcePath);
   const kind = extension === '.dll' ? 'dll' : 'zip';

   return Result.ok({
      status: 'ok',
      installId: request.installId,
      sourcePath: request.sourcePath,
      kind,
      name,
      sizeBytes: info.value.sizeBytes,
      destinationPath: kind === 'dll' ? join(context.install.path, modFolders.pluginsPending, name) : join(context.install.path, modFolders.pending),
      warnings: ['unverified-source']
   });
}

function planInstall(
   installId: string,
   context: ModContext,
   scan: ModScan,
   selectedIds: string[],
   patcherSupported: boolean
): Result<InstallPlan, ModProblem> {
   const plan = buildInstallPlan(context.index, scan, selectedIds);
   if (plan.mods.length === 0) return Result.err({ issue: 'not-found', detail: selectedIds.join(', ') });

   return Result.ok({
      preview: {
         status: 'ok',
         installId,
         installPath: context.install.path,
         pendingPath: join(context.install.path, modFolders.pending),
         ...describeInstallPlan(plan, context.scan, patcherSupported)
      },
      planned: plan.mods
   });
}

async function describeRemoval(context: ModContext, modId: string): Promise<ModRemoval | null> {
   const installed = context.scan.installed.get(modId);
   const entry = context.index.byModId.get(modId);
   if (!installed || !entry) return null;

   const candidates = entry.files.flatMap((file) => modFileCandidates(context.install.path, file.path, entry.isBsipa));
   const files = await Promise.all(
      candidates.map(async (candidate) => {
         const info = await readPathInfo(candidate.absolutePath);
         return Result.isOk(info) && info.value.kind === 'file' ? candidate.absolutePath : null;
      })
   );

   return {
      modId,
      name: entry.name,
      version: installed.version,
      files: [...new Set([...(context.scan.installedFiles.get(modId) ?? []), ...files.filter((file) => file !== null)])]
   };
}
