import { Result } from 'better-result';
import { z } from 'zod';

import { readJsonFile, writeJsonFileAtomic } from '@/lib/filesystem/json';
import { installColorSchema } from '@/modules/installs/contract';
import type { StoreKind } from '@/modules/stores/contract';

import { dirname, join } from 'node:path';

const bsmanagerStoreSchema = z
   .enum(['steam', 'oculus', 'STEAM', 'OCULUS'])
   .transform((store): StoreKind => (store === 'steam' || store === 'STEAM' ? 'steam' : 'oculus'));
const bsmanagerMetadataSchema = z.object({
   id: z.string().optional(),
   store: bsmanagerStoreSchema
});

const bsmanagerVersionSchema = z.object({
   BSVersion: z.string().min(1),
   name: z.string().min(1).optional().catch(undefined),
   color: installColorSchema.optional().catch(undefined),
   steam: z.boolean().optional().catch(undefined),
   oculus: z.boolean().optional().catch(undefined),
   metadata: bsmanagerMetadataSchema.optional().catch(undefined)
});

export const bsmanagerConfigSchema = z
   .looseObject({
      'custom-versions': z
         .array(bsmanagerVersionSchema.nullable().catch(null))
         .catch([])
         .transform((versions) => versions.filter((version) => version !== null))
   })
   .catch({ 'custom-versions': [] });

export const bsmanagerAppConfigSchema = z
   .looseObject({
      'installation-folder': z.string().trim().min(1).optional().catch(undefined),
      'use-symlinks': z.boolean().optional().catch(undefined)
   })
   .catch({});

export type BSManagerConfigVersion = z.infer<typeof bsmanagerVersionSchema>;

export async function readBSManagerConfig(configPath: string) {
   const read = await readJsonFile(configPath, bsmanagerConfigSchema, { defaultValue: { 'custom-versions': [] } });

   return Result.isOk(read) ? read.value : { 'custom-versions': [] };
}

export async function readBSManagerAppConfig(configPath: string) {
   const read = await readJsonFile(configPath, bsmanagerAppConfigSchema, { defaultValue: {} });

   return Result.isOk(read) ? read.value : {};
}

export async function readBSManagerVersionStore(installPath: string) {
   const read = await readJsonFile(join(installPath, 'metadata.config'), bsmanagerMetadataSchema, {
      defaultValue: { store: 'steam' }
   });

   return Result.isOk(read) ? read.value.store : null;
}

export function writeBSManagerAppConfig(configPath: string, config: z.output<typeof bsmanagerAppConfigSchema>) {
   return writeJsonFileAtomic(configPath, config, bsmanagerAppConfigSchema, {
      root: dirname(configPath),
      scope: 'settings'
   });
}

export function bsmanagerVersionFolderName(version: BSManagerConfigVersion) {
   return version.name ?? version.BSVersion;
}

export function bsmanagerStoreKind(version: BSManagerConfigVersion | null, metadataStore: StoreKind | null): StoreKind {
   if (version?.metadata?.store) return version.metadata.store;
   if (version?.oculus) return 'oculus';
   if (version?.steam) return 'steam';

   // BSManager assigns Steam when migrating versions without metadata.
   return metadataStore ?? 'steam';
}
