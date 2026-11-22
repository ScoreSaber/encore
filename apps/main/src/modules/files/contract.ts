import { z } from 'zod';

export const directoryRequestSchema = z.object({ path: z.string().nullable() });

const fileEntrySchema = z.object({
   name: z.string(),
   path: z.string(),
   kind: z.enum(['directory', 'file'])
});

export const directoryListingSchema = z.discriminatedUnion('status', [
   z.object({
      status: z.literal('ok'),
      path: z.string(),
      parent: z.string().nullable(),
      entries: z.array(fileEntrySchema),
      truncated: z.boolean()
   }),
   z.object({ status: z.literal('unreadable'), path: z.string(), parent: z.string().nullable(), detail: z.string() })
]);

export type FileEntry = z.infer<typeof fileEntrySchema>;
export type DirectoryListing = z.infer<typeof directoryListingSchema>;
