import { z } from 'zod';

import type { IpcResult } from '@/app/ipc/core';
import type { InstallId } from '@/modules/installs/contract';
import type { OperationSnapshot } from '@/modules/operations/contract';
import type { SharedFolderId, SharedFolderLinkState } from '@/modules/shared-content/contract';
import type { StoreKind } from '@/modules/stores/contract';
import type { TargetId } from '@/modules/targets/contract';

export const bsmanagerIssueSchema = z.enum([
   'inspect-failed',
   'not-bsmanager',
   'not-found',
   'nothing-selected',
   'nothing-to-clean',
   'nothing-to-adopt',
   'register-failed',
   'unsupported-target'
]);

export type BSManagerIssue = z.infer<typeof bsmanagerIssueSchema>;

export type BSManagerDetection = {
   targetId: TargetId;
   status: 'detected' | 'missing' | 'unsupported';
   rootPath: string | null;
   sharedContentPath: string | null;
   searchedPaths: string[];
};

export type BSManagerFolderLink = {
   id: SharedFolderId;
   relativePath: string;
   state: SharedFolderLinkState;
   linkTargetPath: string | null;
};

export type BSManagerVersion = {
   id: string;
   name: string | null;
   version: string;
   path: string;
   store: StoreKind | null;
   color: string | null;
   status: 'adopted' | 'missing' | 'ready';
   installId: InstallId | null;
   folders: BSManagerFolderLink[];
};

export type ReadyBSManagerPlan = {
   status: 'ok';
   targetId: TargetId;
   rootPath: string;
   versionsPath: string;
   sharedContentPath: string;
   currentSharedRootPath: string;
   sharedRootAdopted: boolean;
   useSymlinks: boolean;
   versions: BSManagerVersion[];
};

export type BSManagerPlanProblem = {
   status: 'invalid';
   targetId: TargetId;
   rootPath: string;
   issue: BSManagerIssue;
   detail?: string;
};

export type BSManagerPlan = ReadyBSManagerPlan | BSManagerPlanProblem;

export type BSManagerAdoptionOutcome = {
   rootPath: string;
   sharedRootPath: string;
   adopted: number;
   skipped: number;
};

export type BSManagerDetectRequest = {
   targetId: TargetId;
};

export type BSManagerPlanRequest = BSManagerDetectRequest;

export type BSManagerAdoptInput = {
   rootPath: string;
   versionIds: string[];
   adoptSharedRoot: boolean;
};
export type BSManagerAdoptRequest = BSManagerAdoptInput & { targetId: TargetId };

export type BSManagerAdoptResult = IpcResult<BSManagerAdoptionOutcome>;

export type BSManagerCleanupInput = {
   rootPath: string;
};
export type BSManagerCleanupRequest = BSManagerCleanupInput & { targetId: TargetId };

export type BSManagerCleanupResult = IpcResult<OperationSnapshot>;

export function invalidBSManagerPlan(targetId: TargetId, rootPath: string, issue: BSManagerIssue, detail?: string): BSManagerPlanProblem {
   return {
      status: 'invalid',
      targetId,
      rootPath,
      issue,
      ...(detail ? { detail } : {})
   };
}
