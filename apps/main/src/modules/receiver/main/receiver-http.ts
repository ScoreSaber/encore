import { Result } from 'better-result';
import { z } from 'zod';

import type { IpcTransportValue } from '@/ipc/core';
import { createProblem, type Problem } from '@/lib/errors';
import { receiverOperations } from '@/modules/receiver/operations';
import { receiverProtocolVersionHeader, receiverSupportedProtocolVersions } from '@/modules/receiver/protocol';

import type { IncomingMessage, ServerResponse } from 'node:http';

const maxJsonBodyBytes = 32 * 1_024;

export type HttpFailure = Problem & { status: number };

export function readBearerToken(request: IncomingMessage) {
   const header = request.headers.authorization;
   if (!header?.startsWith('Bearer ')) return null;

   const token = header.slice('Bearer '.length).trim();
   return token.length > 0 ? token : null;
}

export function checkProtocolVersion(request: IncomingMessage, path: string): HttpFailure | null {
   // discovery must answer mismatched builds so they can negotiate a protocol
   if (path === receiverOperations.health.path) return null;

   const header = request.headers[receiverProtocolVersionHeader];
   const parsedHeader = z.string().safeParse(header);
   const version = parsedHeader.success ? Number.parseInt(parsedHeader.data, 10) : Number.NaN;
   if (Number.isInteger(version) && receiverSupportedProtocolVersions.includes(version)) return null;

   return { status: 426, ...createProblem('receiver.protocol.unsupported') };
}

export function readJsonBody(request: IncomingMessage) {
   return Result.tryPromise({
      try: async () => {
         const chunks: Buffer[] = [];
         let size = 0;

         for await (const chunk of request) {
            if (!(chunk instanceof Uint8Array)) throw new TypeError('Expected binary chunk');
            const buffer = Buffer.from(chunk);
            size += buffer.byteLength;
            if (size > maxJsonBodyBytes) {
               throw new Error('request body is too large');
            }

            chunks.push(buffer);
         }

         return z.json().parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      },
      catch: (cause): HttpFailure => ({ status: 400, ...createProblem('receiver.body.invalid', { cause }) })
   });
}

export function writeJson(response: ServerResponse, status: number, body: IpcTransportValue) {
   response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
   });
   response.end(`${JSON.stringify(body)}\n`);
}

export function writeError(response: ServerResponse, failure: HttpFailure) {
   writeJson(response, failure.status, {
      error: {
         code: failure.code,
         message: failure.message
      }
   });
}
