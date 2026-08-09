import { Result } from 'better-result';

import { causeCode } from '@/lib/errors';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type RegistryValue = {
   name: string;
   type: string;
   value: string;
};

type RegistryKey = {
   key: string;
   subkeys: string[];
   values: RegistryValue[];
};

type RegistryProblem = {
   code: 'registry.missing' | 'registry.query-failed' | 'registry.unsupported';
   key: string;
   detail?: string;
};

export async function queryRegistryValue(key: string, valueName: string) {
   const keyResult = await queryRegistryKey(key, valueName);
   if (Result.isError(keyResult)) return Result.err<RegistryValue, RegistryProblem>(keyResult.error);

   const value = keyResult.value.values.find((item) => item.name.toLowerCase() === valueName.toLowerCase());
   if (!value) {
      return Result.err<RegistryValue, RegistryProblem>({
         code: 'registry.missing',
         key
      });
   }

   return Result.ok<RegistryValue, RegistryProblem>(value);
}

export async function queryRegistryKey(key: string, valueName?: string) {
   if (process.platform !== 'win32') {
      return Result.err<RegistryKey, RegistryProblem>({
         code: 'registry.unsupported',
         key
      });
   }

   const result = await Result.tryPromise({
      try: () => execFileAsync('reg', valueName ? ['query', key, '/v', valueName] : ['query', key], { windowsHide: true }),
      catch: (cause) => createRegistryProblem(key, cause)
   });

   if (Result.isError(result)) return Result.err<RegistryKey, RegistryProblem>(result.error);

   return Result.ok<RegistryKey, RegistryProblem>(parseRegistryKey(key, result.value.stdout));
}

function parseRegistryKey(key: string, output: string): RegistryKey {
   const values: RegistryValue[] = [];
   const subkeys: string[] = [];
   const normalizedKey = canonicalRegistryKey(key);

   for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('HKEY_')) {
         if (canonicalRegistryKey(trimmed) !== normalizedKey) subkeys.push(trimmed);
         continue;
      }

      const value = parseRegistryValue(trimmed);
      if (value) values.push(value);
   }

   return {
      key,
      subkeys,
      values
   };
}

function canonicalRegistryKey(key: string) {
   return key
      .replace(/^HKCU\\/i, 'HKEY_CURRENT_USER\\')
      .replace(/^HKLM\\/i, 'HKEY_LOCAL_MACHINE\\')
      .toLowerCase();
}

function parseRegistryValue(line: string): RegistryValue | null {
   const match = /^(.+?)\s+(REG_\w+)\s*(.*)$/.exec(line);
   if (!match?.[1] || !match[2]) return null;

   return {
      name: match[1].trim(),
      type: match[2],
      value: (match[3] ?? '').trim()
   };
}

function createRegistryProblem(key: string, cause: unknown): RegistryProblem {
   const detail =
      cause && typeof cause === 'object' && 'code' in cause && (typeof cause.code === 'string' || typeof cause.code === 'number')
         ? `exit-${cause.code}`
         : causeCode(cause);

   return {
      code: detail === 'exit-1' ? 'registry.missing' : 'registry.query-failed',
      key,
      detail
   };
}
