import { z } from 'zod';

export const storeKindSchema = z.enum(['steam', 'oculus']);
export const storeKinds = storeKindSchema.options;
export type StoreKind = z.infer<typeof storeKindSchema>;

export type StoreInstallCandidate = {
   store: StoreKind;
   path: string;
   libraryPath: string;
   appId?: string;
};
