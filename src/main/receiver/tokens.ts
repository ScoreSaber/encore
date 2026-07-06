import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const tokenBytes = 32;
const codeMin = 100_000;
const codeMaxExclusive = 1_000_000;

export function createPairingCode() {
   return randomInt(codeMin, codeMaxExclusive).toString();
}

export function createReceiverToken() {
   return randomBytes(tokenBytes).toString('base64url');
}

export function hashReceiverToken(token: string) {
   return createHash('sha256').update(token, 'utf8').digest('base64url');
}

export function receiverTokenHashesEqual(first: string, second: string) {
   const firstBuffer = Buffer.from(first, 'utf8');
   const secondBuffer = Buffer.from(second, 'utf8');

   return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}
