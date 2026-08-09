import { z } from 'zod';

import { defineDomainApi, targetProcedure, type TargetCall } from '@/lib/api';
import { operationResultSchema } from '@/modules/operations/contract';
import {
   sharedConnectActionSchema,
   sharedConnectPreviewSchema,
   customSharedFolderActionResultSchema,
   relativeFolderPathSchema,
   sharedContentActionSchema,
   sharedContentOverviewSchema,
   sharedContentPreviewSchema,
   sharedContentSnapshotSchema,
   sharedContentsModeSchema,
   sharedFolderIdSchema,
   sharedRootActionResultSchema,
   sharedRootCandidateSchema
} from '@/modules/shared-content/contract';

const install = z.object({ installId: z.string().min(1) });
const path = z.object({ path: z.string().trim().min(1) });

export const sharedContentApi = defineDomainApi(
   'shared-content',
   {
      list: targetProcedure({ capability: 'share-content', input: install, output: sharedContentSnapshotSchema }),
      rescan: targetProcedure({ capability: 'share-content', input: install, output: sharedContentSnapshotSchema }),
      getOverview: targetProcedure({ capability: 'share-content', output: sharedContentOverviewSchema }),
      preview: targetProcedure({
         capability: 'share-content',
         input: install.extend({
            folderId: sharedFolderIdSchema,
            action: sharedContentActionSchema,
            contents: sharedContentsModeSchema.optional()
         }),
         output: sharedContentPreviewSchema
      }),
      start: targetProcedure({
         capability: 'share-content',
         input: install.extend({
            folderId: sharedFolderIdSchema,
            action: sharedContentActionSchema,
            contents: sharedContentsModeSchema.optional()
         }),
         output: operationResultSchema
      }),
      previewConnect: targetProcedure({
         capability: 'share-content',
         input: install.extend({
            action: sharedConnectActionSchema,
            rootPath: z.string().trim().min(1).optional(),
            contents: sharedContentsModeSchema.optional(),
            includeRisky: z.boolean().optional()
         }),
         output: sharedConnectPreviewSchema
      }),
      startConnect: targetProcedure({
         capability: 'share-content',
         input: install.extend({
            action: sharedConnectActionSchema,
            rootPath: z.string().trim().min(1).optional(),
            contents: sharedContentsModeSchema.optional(),
            includeRisky: z.boolean().optional()
         }),
         output: operationResultSchema
      }),
      addCustomFolder: targetProcedure({
         capability: 'share-content',
         input: install.extend({ relativePath: relativeFolderPathSchema }),
         output: customSharedFolderActionResultSchema
      }),
      forgetCustomFolder: targetProcedure({
         capability: 'share-content',
         input: z.object({ folderId: sharedFolderIdSchema }),
         output: customSharedFolderActionResultSchema
      }),
      chooseRootCandidate: targetProcedure({ capability: 'share-content', input: path, output: sharedRootCandidateSchema }),
      addRoot: targetProcedure({
         capability: 'share-content',
         input: path.extend({ activate: z.boolean().optional() }),
         output: sharedRootActionResultSchema
      }),
      activateRoot: targetProcedure({ capability: 'share-content', input: path, output: sharedRootActionResultSchema }),
      forgetRoot: targetProcedure({ capability: 'share-content', input: path, output: sharedRootActionResultSchema })
   },
   { snapshot: sharedContentSnapshotSchema }
);

export type TargetSharedContentRequest = TargetCall<typeof sharedContentApi.procedures.list>;
export type TargetSharedContentActionRequest = TargetCall<typeof sharedContentApi.procedures.preview>;
export type TargetSharedConnectRequest = TargetCall<typeof sharedContentApi.procedures.previewConnect>;
