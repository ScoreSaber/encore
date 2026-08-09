import { z } from 'zod';

import { defineDomainApi, targetProcedure, targetUpload, type TargetCall } from '@/lib/api';
import {
   modChangesPreviewSchema,
   modInstallPreviewSchema,
   modImportPreviewSchema,
   modImportUploadIdSchema,
   modImportUploadPreparedSchema,
   modImportUploadRequestSchema,
   modRepositorySyncRequestSchema,
   modRepositorySyncResultSchema,
   modsSnapshotSchema,
   modUninstallPreviewSchema,
   modUninstallScopeSchema
} from '@/modules/mods/contract';
import { operationResultSchema } from '@/modules/operations/contract';

const install = z.object({ installId: z.string().min(1) });
const selection = install.extend({ modIds: z.array(z.string().min(1)) });
const changes = install.extend({ installModIds: z.array(z.string().min(1)), removeModIds: z.array(z.string().min(1)) });

export const modsApi = defineDomainApi(
   'mods',
   {
      getMods: targetProcedure({ capability: 'manage-mods', input: install, output: modsSnapshotSchema }),
      refreshMods: targetProcedure({ capability: 'manage-mods', input: install, output: modsSnapshotSchema }),
      syncRepositories: targetProcedure({ capability: 'manage-mods', input: modRepositorySyncRequestSchema, output: modRepositorySyncResultSchema }),
      prepareImportUpload: targetProcedure({ capability: 'manage-mods', input: modImportUploadRequestSchema, output: modImportUploadPreparedSchema }),
      previewImportUpload: targetProcedure({ capability: 'manage-mods', input: modImportUploadIdSchema, output: modImportPreviewSchema }),
      importUpload: targetProcedure({ capability: 'manage-mods', input: modImportUploadIdSchema, output: operationResultSchema }),
      discardImportUpload: targetProcedure({
         capability: 'manage-mods',
         input: modImportUploadIdSchema,
         output: z.object({ discarded: z.boolean() })
      }),
      previewInstall: targetProcedure({ capability: 'manage-mods', input: selection, output: modInstallPreviewSchema }),
      installMods: targetProcedure({ capability: 'manage-mods', input: selection, output: operationResultSchema }),
      previewChanges: targetProcedure({ capability: 'manage-mods', input: changes, output: modChangesPreviewSchema }),
      applyChanges: targetProcedure({ capability: 'manage-mods', input: changes, output: operationResultSchema }),
      previewUninstall: targetProcedure({
         capability: 'manage-mods',
         input: selection.extend({ scope: modUninstallScopeSchema }),
         output: modUninstallPreviewSchema
      }),
      uninstallMods: targetProcedure({
         capability: 'manage-mods',
         input: selection.extend({ scope: modUninstallScopeSchema }),
         output: operationResultSchema
      })
   },
   {
      uploads: {
         importFile: targetUpload({ capability: 'manage-mods', input: modImportUploadIdSchema })
      }
   }
);

export type TargetModRequest = TargetCall<typeof modsApi.procedures.getMods>;
export type TargetModSelectionRequest = TargetCall<typeof modsApi.procedures.previewInstall>;
export type TargetModUninstallRequest = TargetCall<typeof modsApi.procedures.previewUninstall>;
