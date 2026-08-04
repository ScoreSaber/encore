import { z } from 'zod';

export const storeKindSchema = z.enum(['steam', 'oculus']);
export const storeKinds = storeKindSchema.options;
export type StoreKind = z.infer<typeof storeKindSchema>;

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
   executablePath: z.string().optional()
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

export const storeDetectionResultSchema = storeDetectionSnapshotSchema.omit({ targetId: true });

export type StoreDetectionDiagnostic = z.infer<typeof storeDetectionDiagnosticSchema>;
export type StoreLibrarySummary = z.infer<typeof storeLibrarySummarySchema>;
export type StoreInstallCandidate = z.infer<typeof storeInstallCandidateSchema>;
export type StoreDetectionStoreSummary = z.infer<typeof storeDetectionStoreSummarySchema>;
export type StoreDetectionSnapshot = z.infer<typeof storeDetectionSnapshotSchema>;
export type StoreDetectionResult = z.infer<typeof storeDetectionResultSchema>;
