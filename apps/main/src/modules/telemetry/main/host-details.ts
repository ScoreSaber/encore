import { Result } from 'better-result';

import { open } from 'node:fs/promises';
import { join } from 'node:path';

const metadataReadLimit = 1_024;

export async function readTelemetryHostDetails(platform: NodeJS.Platform, protonPath: string | null) {
   if (platform !== 'linux') return { linuxDistribution: null, protonVersion: null };

   let linuxDistribution: string | null = null;
   for (const path of ['/run/host/os-release', '/run/host/etc/os-release', '/etc/os-release']) {
      const contents = await readMetadataFile(path);
      if (contents === null) continue;

      linuxDistribution = describeLinuxDistribution(contents);
      break;
   }

   let protonVersion: string | null = null;
   if (protonPath) {
      const contents = await readMetadataFile(join(protonPath, 'version'));
      if (contents !== null) protonVersion = describeProtonVersion(contents);
   }

   return { linuxDistribution, protonVersion };
}

export function describeLinuxDistribution(osRelease: string) {
   const fields = new Map<string, string>();
   for (const line of osRelease.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match?.[1] || match[2] === undefined) continue;

      const value = match[2];
      const quoted = value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
      fields.set(match[1], quoted ? value.slice(1, -1).replaceAll('\\"', '"').replaceAll('\\\\', '\\') : value);
   }

   const name = cleanMetadataValue(fields.get('NAME'));
   if (!name) return null;

   const version = fields.get('VERSION_ID')?.match(/^\d+(?:\.\d+)?/)?.[0];
   return version ? `${name} ${version}` : name;
}

export function describeProtonVersion(versionFile: string) {
   const version = cleanMetadataValue(versionFile.split(/\r?\n/, 1)[0]);
   return version?.replace(/^\d{9,}\s+/, '') || null;
}

async function readMetadataFile(path: string) {
   const opened = await Result.tryPromise({
      try: () => open(path, 'r'),
      catch: () => undefined
   });
   if (Result.isError(opened)) return null;

   const buffer = Buffer.alloc(metadataReadLimit);
   const read = await Result.tryPromise({
      try: () => opened.value.read(buffer, 0, buffer.length, 0),
      catch: () => undefined
   });
   await Result.tryPromise({
      try: () => opened.value.close(),
      catch: () => undefined
   });

   return Result.isOk(read) ? buffer.toString('utf8', 0, read.value.bytesRead) : null;
}

function cleanMetadataValue(value: string | undefined) {
   if (!value) return null;

   const cleaned = value
      .replaceAll(/\p{Cc}/gu, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim();
   return cleaned ? cleaned.slice(0, 100) : null;
}
