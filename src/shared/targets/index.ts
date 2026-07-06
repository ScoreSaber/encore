import { z } from 'zod';

export const storeKindSchema = z.enum(['steam', 'oculus']);
export const storeKinds = storeKindSchema.options;
export type StoreKind = z.infer<typeof storeKindSchema>;

export const localTargetId = 'local';

export type TargetId = string;
export type InstallId = string;

export const targetCapabilitySchema = z.enum(['detect-stores', 'list-installs']);
export const targetStatusSchema = z.enum(['ready', 'unpaired', 'disconnected']);
export const targetSchema = z.object({
   id: z.string(),
   kind: z.enum(['local', 'remote']),
   name: z.string(),
   status: targetStatusSchema,
   capabilities: z.array(targetCapabilitySchema)
});

export const storeDetectionStatusSchema = z.enum(['detected', 'error', 'missing', 'unsupported']);
export const storeDetectionSeveritySchema = z.enum(['error', 'info', 'warning']);
export const storeDetectionDiagnosticCodeSchema = z.enum([
   'oculus.beat-saber-missing',
   'oculus.detected',
   'oculus.libraries-missing',
   'oculus.registry-read-failed',
   'oculus.unsupported-platform',
   'steam.beat-saber-missing',
   'steam.detected',
   'steam.libraryfolders-missing',
   'steam.libraryfolders-read-failed',
   'steam.root-missing',
   'steam.unsupported-platform'
]);

export const storeDetectionDiagnosticSchema = z.object({
   id: z.string(),
   store: storeKindSchema,
   severity: storeDetectionSeveritySchema,
   code: storeDetectionDiagnosticCodeSchema,
   path: z.string().optional(),
   detail: z.string().optional()
});

export const storeLibrarySummarySchema = z.object({
   id: z.string(),
   store: storeKindSchema,
   path: z.string(),
   isDefault: z.boolean().optional(),
   hasBeatSaber: z.boolean(),
   manifestPath: z.string().optional(),
   installPath: z.string().optional()
});

export const storeInstallCandidateSchema = z.object({
   id: z.string(),
   targetId: z.string(),
   store: storeKindSchema,
   path: z.string(),
   libraryPath: z.string(),
   appId: z.string().optional(),
   manifestPath: z.string().optional(),
   executablePath: z.string().optional(),
   isReadOnly: z.literal(true),
   isProtected: z.literal(true)
});

export const storeDetectionStoreSummarySchema = z.object({
   store: storeKindSchema,
   status: storeDetectionStatusSchema,
   libraries: z.array(storeLibrarySummarySchema),
   diagnostics: z.array(storeDetectionDiagnosticSchema),
   clientPath: z.string().optional()
});

export const storeDetectionSnapshotSchema = z.object({
   targetId: z.string(),
   platform: z.string(),
   scannedAt: z.string(),
   stores: z.array(storeDetectionStoreSummarySchema),
   candidates: z.array(storeInstallCandidateSchema),
   diagnostics: z.array(storeDetectionDiagnosticSchema)
});

export const installSourceSchema = z.enum(['managed', 'store']);
export const installSummarySchema = z.object({
   id: z.string(),
   targetId: z.string(),
   version: z.string(),
   name: z.string().optional(),
   store: storeKindSchema.nullable(),
   source: installSourceSchema.optional(),
   path: z.string().optional(),
   isReadOnly: z.boolean().optional(),
   isProtected: z.boolean().optional(),
   storeCandidate: storeInstallCandidateSchema.optional()
});

export const targetEventSchema = z.discriminatedUnion('type', [
   z.object({
      type: z.literal('target-updated'),
      target: targetSchema
   }),
   z.object({
      type: z.literal('installs-updated'),
      targetId: z.string(),
      installs: z.array(installSummarySchema)
   }),
   z.object({
      type: z.literal('store-detection-updated'),
      targetId: z.string(),
      snapshot: storeDetectionSnapshotSchema
   })
]);

export type Target = z.infer<typeof targetSchema>;
export type TargetKind = Target['kind'];
export type TargetStatus = z.infer<typeof targetStatusSchema>;
export type TargetCapability = z.infer<typeof targetCapabilitySchema>;

export type StoreDetectionStatus = z.infer<typeof storeDetectionStatusSchema>;
export type StoreDetectionSeverity = z.infer<typeof storeDetectionSeveritySchema>;
export type StoreDetectionDiagnosticCode = z.infer<typeof storeDetectionDiagnosticCodeSchema>;
export type StoreDetectionDiagnostic = z.infer<typeof storeDetectionDiagnosticSchema>;
export type StoreLibrarySummary = z.infer<typeof storeLibrarySummarySchema>;
export type StoreInstallCandidate = z.infer<typeof storeInstallCandidateSchema>;
export type StoreDetectionStoreSummary = z.infer<typeof storeDetectionStoreSummarySchema>;
export type StoreDetectionSnapshot = z.infer<typeof storeDetectionSnapshotSchema>;
export type InstallSource = z.infer<typeof installSourceSchema>;
export type InstallSummary = z.infer<typeof installSummarySchema>;
export type TargetEvent = z.infer<typeof targetEventSchema>;

export type TargetHealth = {
   status: TargetStatus;
   capabilities: TargetCapability[];
   message?: string;
};

export type TargetClient = {
   listTargets: () => Promise<Target[]>;
   listInstalls: (targetId: TargetId) => Promise<InstallSummary[]>;
   getHealth: (targetId: TargetId) => Promise<TargetHealth | null>;
   getStoreDetection: (targetId: TargetId) => Promise<StoreDetectionSnapshot | null>;
   rescanStores: (targetId: TargetId) => Promise<StoreDetectionSnapshot | null>;
   onEvent: (listener: (event: TargetEvent) => void) => () => void;
};
