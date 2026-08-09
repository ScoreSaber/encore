import { createHash } from 'node:crypto';

export function customSharedFolderId(installRelativePath: string, libraryRelativePath: string) {
   const hash = createHash('sha256')
      .update(installRelativePath)
      .update(String.fromCodePoint(0))
      .update(libraryRelativePath)
      .digest('hex')
      .slice(0, 24);

   return `custom-${hash}`;
}
