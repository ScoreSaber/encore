import { z } from 'zod';

export const storeKindSchema = z.enum(['steam', 'oculus']);
export const storeKinds = storeKindSchema.options;
export type StoreKind = z.infer<typeof storeKindSchema>;

export const localTargetId = 'local';

export type TargetId = string;
export type InstallId = string;

export type TargetKind = 'local' | 'remote';

export type TargetStatus = 'ready' | 'unpaired' | 'disconnected';

export type TargetCapability = 'detect-stores' | 'list-installs';

export type StoreDetectionStatus = 'detected' | 'error' | 'missing' | 'unsupported';
export type StoreDetectionSeverity = 'error' | 'info' | 'warning';
export type StoreDetectionDiagnosticCode =
   | 'oculus.beat-saber-missing'
   | 'oculus.detected'
   | 'oculus.libraries-missing'
   | 'oculus.registry-read-failed'
   | 'oculus.unsupported-platform'
   | 'steam.beat-saber-missing'
   | 'steam.detected'
   | 'steam.libraryfolders-missing'
   | 'steam.libraryfolders-read-failed'
   | 'steam.root-missing'
   | 'steam.unsupported-platform';

export type StoreDetectionDiagnostic = {
   id: string;
   store: StoreKind;
   severity: StoreDetectionSeverity;
   code: StoreDetectionDiagnosticCode;
   path?: string;
   detail?: string;
};

export type StoreLibrarySummary = {
   id: string;
   store: StoreKind;
   path: string;
   isDefault?: boolean;
   hasBeatSaber: boolean;
   manifestPath?: string;
   installPath?: string;
};

export type StoreInstallCandidate = {
   id: InstallId;
   targetId: TargetId;
   store: StoreKind;
   path: string;
   libraryPath: string;
   appId?: string;
   manifestPath?: string;
   executablePath?: string;
   isReadOnly: true;
   isProtected: true;
};

export type StoreDetectionStoreSummary = {
   store: StoreKind;
   status: StoreDetectionStatus;
   libraries: StoreLibrarySummary[];
   diagnostics: StoreDetectionDiagnostic[];
   clientPath?: string;
};

export type StoreDetectionSnapshot = {
   targetId: TargetId;
   platform: NodeJS.Platform | 'browser';
   scannedAt: string;
   stores: StoreDetectionStoreSummary[];
   candidates: StoreInstallCandidate[];
   diagnostics: StoreDetectionDiagnostic[];
};

export type InstallSource = 'managed' | 'store';

export type Target = {
   id: TargetId;
   kind: TargetKind;
   name: string;
   status: TargetStatus;
   capabilities: TargetCapability[];
};

export type TargetHealth = {
   status: TargetStatus;
   capabilities: TargetCapability[];
   message?: string;
};

export type InstallSummary = {
   id: InstallId;
   targetId: TargetId;
   version: string;
   name?: string;
   store: StoreKind | null;
   source?: InstallSource;
   path?: string;
   isReadOnly?: boolean;
   isProtected?: boolean;
   storeCandidate?: StoreInstallCandidate;
};

export type TargetEvent =
   | {
        type: 'target-updated';
        target: Target;
     }
   | {
        type: 'installs-updated';
        targetId: TargetId;
        installs: InstallSummary[];
     }
   | {
        type: 'store-detection-updated';
        targetId: TargetId;
        snapshot: StoreDetectionSnapshot;
     };

export type TargetClient = {
   listTargets: () => Promise<Target[]>;
   listInstalls: (targetId: TargetId) => Promise<InstallSummary[]>;
   getHealth: (targetId: TargetId) => Promise<TargetHealth | null>;
   getStoreDetection: (targetId: TargetId) => Promise<StoreDetectionSnapshot | null>;
   rescanStores: (targetId: TargetId) => Promise<StoreDetectionSnapshot | null>;
   onEvent: (listener: (event: TargetEvent) => void) => () => void;
};
