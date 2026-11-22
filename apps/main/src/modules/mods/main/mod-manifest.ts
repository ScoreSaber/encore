import { Result } from 'better-result';
import { z } from 'zod';

import { findClrHeader, readAt } from '@/lib/dotnet/clr-header';
import type { ExternalModDetails, ModLinkKind } from '@/modules/mods/contract';

import { open, type FileHandle } from 'node:fs/promises';

const maxManifestBytes = 64 * 1024;
const maxResources = 256;

const manifestSchema = z.object({
   name: z.string().min(1).max(200),
   version: z.string().max(100).optional(),
   author: z.string().max(200).optional(),
   gameVersion: z.string().max(100).optional(),
   description: z.union([z.string(), z.array(z.string())]).optional(),
   links: z.record(z.string(), z.string()).optional()
});

const linkKinds = new Map<string, ModLinkKind>([
   ['project-home', 'listing'],
   ['project-source', 'source']
]);

async function findManifest(file: FileHandle) {
   const found = await findClrHeader(file);
   if (!found) return null;
   const resources = found.fileOffset(found.clr.readUInt32LE(24));
   const resourcesSize = found.clr.readUInt32LE(28);
   if (resources === null) return null;

   let position = 0;
   for (let count = 0; count < maxResources && position + 4 <= resourcesSize; count += 1) {
      const lengthBytes = await readAt(file, resources + position, 4);
      if (lengthBytes.length < 4) return null;
      const length = lengthBytes.readUInt32LE(0);
      if (length > resourcesSize - position - 4) return null;

      if (length <= maxManifestBytes) {
         const text = (await readAt(file, resources + position + 4, length)).toString('utf8').replace(/^﻿/, '');
         if (text.trimStart().startsWith('{')) {
            const parsed = Result.try(() => manifestSchema.parse(JSON.parse(text)));
            if (Result.isOk(parsed)) return parsed.value;
         }
      }
      position = Math.ceil((position + 4 + length) / 8) * 8;
   }
   return null;
}

export async function readEmbeddedManifest(path: string): Promise<ExternalModDetails | null> {
   const file = await Result.tryPromise(() => open(path, 'r'));
   if (Result.isError(file)) return null;

   const manifest = await Result.tryPromise(() => findManifest(file.value));
   await file.value.close();
   if (Result.isError(manifest) || !manifest.value) return null;

   const { name, version, author, gameVersion, description, links } = manifest.value;
   return {
      name,
      version: version ?? null,
      author: author ?? null,
      gameVersion: gameVersion ?? null,
      description: Array.isArray(description) ? description.join('\n') : (description ?? null),
      links: Object.entries(links ?? {}).flatMap(([key, url]) => {
         const kind = linkKinds.get(key);
         return kind && URL.canParse(url) && new URL(url).protocol === 'https:' ? [{ kind, url }] : [];
      })
   };
}
