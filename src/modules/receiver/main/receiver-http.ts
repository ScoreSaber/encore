import { Result } from 'better-result';

import { causeMessage } from '@/lib/errors';
import { receiverOperations } from '@/modules/receiver/operations';
import { isSupportedReceiverProtocolVersion, receiverProtocolVersionHeader } from '@/modules/receiver/protocol';

import type { IncomingMessage, ServerResponse } from 'node:http';

const maxJsonBodyBytes = 32 * 1_024;

export type HttpFailure = {
   status: number;
   code: string;
   message: string;
};

export function readBearerToken(request: IncomingMessage) {
   const header = request.headers.authorization;
   if (!header?.startsWith('Bearer ')) return null;

   const token = header.slice('Bearer '.length).trim();
   return token.length > 0 ? token : null;
}

export function readRequestAddress(request: IncomingMessage) {
   return request.socket.remoteAddress ?? 'unknown';
}

export function checkProtocolVersion(request: IncomingMessage, path: string): HttpFailure | null {
   // discovery must answer mismatched builds so they can negotiate a protocol
   if (path === receiverOperations.health.path) return null;

   const header = request.headers[receiverProtocolVersionHeader];
   const version = typeof header === 'string' ? Number.parseInt(header, 10) : Number.NaN;
   if (Number.isInteger(version) && isSupportedReceiverProtocolVersion(version)) return null;

   return {
      status: 426,
      code: 'receiver.protocol.unsupported',
      message: 'Receiver does not support the requested protocol version'
   };
}

export function readJsonBody(request: IncomingMessage) {
   return Result.tryPromise({
      try: async (): Promise<unknown> => {
         const chunks: Buffer[] = [];
         let size = 0;

         for await (const chunk of request) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.byteLength;
            if (size > maxJsonBodyBytes) {
               throw new Error('request body is too large');
            }

            chunks.push(buffer);
         }

         return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      },
      catch: (cause): HttpFailure => ({
         status: 400,
         code: 'receiver.body.invalid',
         message: causeMessage(cause)
      })
   });
}

export function writeJson(response: ServerResponse, status: number, body: object) {
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

export function unauthorizedFailure(): HttpFailure {
   return {
      status: 401,
      code: 'receiver.auth.required',
      message: 'A valid pairing token is required'
   };
}
