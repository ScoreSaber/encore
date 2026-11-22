import { Result } from 'better-result';
import { z } from 'zod';

import { createProblem, type Problem } from '@/lib/errors';

export const defaultReceiverPort = 38_567;
export const receiverPortSchema = z.int().min(1).max(65_535);
export const receiverBindHostSchema = z
   .string()
   .trim()
   .pipe(z.union([z.ipv4(), z.ipv6(), z.hostname()]));

type ReceiverAddress = { host: string; port: number };

export function receiverAddressUrl({ host, port }: ReceiverAddress) {
   return `https://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

export function parseReceiverHost(address: string): Result<ReceiverAddress, Problem> {
   const trimmed = address.trim();
   const explicitScheme = trimmed.includes('://');
   const host = z.ipv6().safeParse(trimmed).success ? `[${trimmed}]` : trimmed;
   const parsed = Result.try({
      try: () => new URL(explicitScheme ? host : `https://${host}`),
      catch: () => createProblem('receiver.remote.host.invalid')
   });
   if (Result.isError(parsed)) return Result.err(parsed.error);

   const url = parsed.value;
   if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      return Result.err(createProblem('receiver.remote.host.unsupported'));
   }

   const hostname = url.hostname.replace(/^\[|\]$/g, '');
   const explicitPort = host.split('/')[explicitScheme ? 2 : 0]?.match(/:(\d+)$/)?.[1];
   const port = explicitPort ? Number(explicitPort) : explicitScheme ? 443 : defaultReceiverPort;
   if (!receiverBindHostSchema.safeParse(hostname).success || !receiverPortSchema.safeParse(port).success) {
      return Result.err(createProblem('receiver.remote.host.out-of-range'));
   }

   return Result.ok({ host: hostname, port });
}
