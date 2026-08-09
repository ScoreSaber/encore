import { z } from 'zod';

export type OperationId = string;

export type OperationSerializable =
   | string
   | number
   | boolean
   | null
   | readonly OperationSerializable[]
   | { readonly [key: string]: OperationSerializable | undefined };

export const operationSerializableSchema: z.ZodType<OperationSerializable> = z.lazy(() =>
   z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(operationSerializableSchema),
      z.record(z.string(), operationSerializableSchema.optional())
   ])
);

export const operationKindSchema = z.enum(['import', 'download', 'copy', 'delete', 'verification', 'launch-preparation', 'receiver-command']);
export const operationStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);

export const operationProgressSchema = z.object({
   phase: z.string().optional(),
   label: z.string().optional(),
   current: z.number().optional(),
   total: z.number().optional(),
   percent: z.number().optional(),
   unit: z.enum(['bytes', 'files', 'items', 'steps']).optional()
});

export const operationErrorSchema = z.object({
   code: z.string(),
   message: z.string(),
   details: operationSerializableSchema.optional()
});

export const operationSnapshotSchema = z.object({
   id: z.string(),
   kind: operationKindSchema,
   status: operationStatusSchema,
   title: z.string(),
   message: z.string().optional(),
   progress: operationProgressSchema.optional(),
   cancelable: z.boolean(),
   metadata: operationSerializableSchema.optional(),
   result: operationSerializableSchema.optional(),
   error: operationErrorSchema.optional(),
   createdAt: z.string(),
   updatedAt: z.string(),
   completedAt: z.string().optional()
});

export const operationCancelResultSchema = z.union([
   z.object({
      ok: z.literal(true),
      status: z.literal('cancelled'),
      operation: operationSnapshotSchema
   }),
   z.object({
      ok: z.literal(true),
      status: z.literal('noop'),
      reason: z.enum(['already-finished', 'not-cancelable', 'not-found']),
      id: z.string(),
      operation: operationSnapshotSchema.optional()
   }),
   z.object({
      ok: z.literal(false),
      status: z.literal('failed'),
      id: z.string(),
      operation: operationSnapshotSchema.optional(),
      error: operationErrorSchema
   })
]);

export const operationResultSchema = z.union([
   z.object({ ok: z.literal(true), value: operationSnapshotSchema }),
   z.object({ ok: z.literal(false), error: operationErrorSchema })
]);

export type OperationKind = z.infer<typeof operationKindSchema>;
export type OperationStatus = z.infer<typeof operationStatusSchema>;
export type OperationProgress = z.infer<typeof operationProgressSchema>;
export type OperationError = z.infer<typeof operationErrorSchema>;
export type OperationSnapshot = z.infer<typeof operationSnapshotSchema>;
export type OperationCancelResult = z.infer<typeof operationCancelResultSchema>;

export type OperationCancelRequest = {
   id: OperationId;
};

export const terminalOperationStatuses: readonly OperationStatus[] = ['completed', 'failed', 'cancelled'];

export function isOperationTerminalStatus(status: OperationStatus) {
   return terminalOperationStatuses.includes(status);
}
