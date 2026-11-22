import { Result } from 'better-result';

import { endOfDirectoryRecord, readAt, uint32, writeAt, type ApkArchive } from '@/lib/android/apk-archive';
import { causeCode, createProblem, type Problem } from '@/lib/errors';
import { publishFileExclusive } from '@/lib/filesystem/atomic-write';
import { removeQuietly } from '@/lib/filesystem/path';

import { createHash, createPrivateKey, randomUUID, sign, X509Certificate } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const chunkSize = 0x100000;
const chunkPrefix = 0xa5;
const digestPrefix = 0x5a;
const rsaPkcs1Sha256 = 0x0103;
const v2BlockId = 0x7109871a;
const blockFooter = 'APK Sig Block 42';

const certificateLifetimeDays = 365 * 30;
const keyAlgorithm = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };

export type ApkSigningKey = {
   privateKeyPem: string;
   certificateDer: Buffer;
   publicKeyDer: Buffer;
};

export async function loadApkSigningKey(path: string): Promise<Result<ApkSigningKey, Problem>> {
   const existing = await Result.tryPromise({ try: () => readFile(path, 'utf8'), catch: (cause) => cause });
   if (Result.isOk(existing)) return Result.try({ try: () => keyFromPem(existing.value), catch: signingKeyError });
   if (causeCode(existing.error) !== 'ENOENT') return Result.err(signingKeyError(existing.error));

   const temporary = `${path}.${randomUUID()}.tmp`;
   const generated = await Result.tryPromise({
      try: async () => {
         const pem = await generateSigningPem();
         await mkdir(dirname(path), { recursive: true });
         await writeFile(temporary, pem, { mode: 0o600 });
         return pem;
      },
      catch: signingKeyError
   });
   if (Result.isError(generated)) {
      await removeQuietly(temporary);
      return Result.err(generated.error);
   }

   const published = await Result.tryPromise({ try: () => publishFileExclusive(temporary, path), catch: (cause) => cause });
   await removeQuietly(temporary);
   if (Result.isError(published) && causeCode(published.error) !== 'EEXIST') return Result.err(signingKeyError(published.error));
   return Result.tryPromise({ try: async () => keyFromPem(await readFile(path, 'utf8')), catch: signingKeyError });
}

export async function signApkV2(archive: ApkArchive, key: ApkSigningKey) {
   const written = await archive.writeEntries();
   const digest = await apkDigest(
      archive.handle,
      written.entriesEnd,
      written.centralDirectory,
      endOfDirectoryRecord(written.count, written.centralDirectory.length, written.entriesEnd)
   );

   const block = signingBlock(digest, key);
   const directoryOffset = written.entriesEnd + block.length;
   const endOfDirectory = endOfDirectoryRecord(written.count, written.centralDirectory.length, directoryOffset);
   const directoryEnd = directoryOffset + written.centralDirectory.length;

   await writeAt(archive.handle, written.entriesEnd, block);
   await writeAt(archive.handle, directoryOffset, written.centralDirectory);
   await writeAt(archive.handle, directoryEnd, endOfDirectory);
   await archive.handle.truncate(directoryEnd + endOfDirectory.length);
}

function signingBlock(digest: Buffer, key: ApkSigningKey) {
   const signedData = Buffer.concat([
      lengthPrefixedSequence([Buffer.concat([uint32(rsaPkcs1Sha256), lengthPrefixed(digest)])]),
      lengthPrefixedSequence([key.certificateDer]),
      uint32(0)
   ]);

   const signature = sign('sha256', signedData, createPrivateKey(key.privateKeyPem));
   const signer = Buffer.concat([
      lengthPrefixed(signedData),
      lengthPrefixedSequence([Buffer.concat([uint32(rsaPkcs1Sha256), lengthPrefixed(signature)])]),
      lengthPrefixed(key.publicKeyDer)
   ]);

   const signers = lengthPrefixedSequence([signer]);
   const pair = Buffer.concat([uint64(4 + signers.length), uint32(v2BlockId), signers]);
   const size = pair.length + 8 + blockFooter.length;

   return Buffer.concat([uint64(size), pair, uint64(size), Buffer.from(blockFooter, 'ascii')]);
}

async function apkDigest(handle: FileHandle, entriesEnd: number, centralDirectory: Buffer, endOfDirectory: Buffer) {
   const digests: Buffer[] = [];

   for (let offset = 0; offset < entriesEnd; offset += chunkSize) {
      digests.push(chunkDigest(await readAt(handle, offset, Math.min(chunkSize, entriesEnd - offset))));
   }

   for (const section of [centralDirectory, endOfDirectory]) {
      for (let offset = 0; offset < section.length; offset += chunkSize) {
         digests.push(chunkDigest(section.subarray(offset, offset + chunkSize)));
      }
   }

   const header = Buffer.alloc(5);
   header.writeUInt8(digestPrefix, 0);
   header.writeUInt32LE(digests.length, 1);

   return createHash('sha256')
      .update(Buffer.concat([header, ...digests]))
      .digest();
}

function chunkDigest(contents: Buffer) {
   const header = Buffer.alloc(5);
   header.writeUInt8(chunkPrefix, 0);
   header.writeUInt32LE(contents.length, 1);

   return createHash('sha256').update(header).update(contents).digest();
}

function keyFromPem(pem: string): ApkSigningKey {
   const certificatePem = pemBlock(pem, 'CERTIFICATE');
   const certificate = new X509Certificate(certificatePem);
   const privateKeyPem = pemBlock(pem, 'PRIVATE KEY');
   if (!certificate.checkPrivateKey(createPrivateKey(privateKeyPem))) throw new Error('the signing certificate does not match its private key');

   return {
      privateKeyPem,
      certificateDer: certificate.raw,
      publicKeyDer: certificate.publicKey.export({ format: 'der', type: 'spki' })
   };
}

function pemBlock(pem: string, label: string) {
   const block = new RegExp(`-----BEGIN ${label}-----[^-]+-----END ${label}-----`).exec(pem);
   if (!block) throw new Error(`the apk signing key is missing its ${label.toLowerCase()}`);

   return block[0];
}

async function generateSigningPem() {
   const x509 = await import('@peculiar/x509');
   const crypto = globalThis.crypto;
   x509.cryptoProvider.set(crypto);

   const keys = await crypto.subtle.generateKey(keyAlgorithm, true, ['sign', 'verify']);
   const now = Date.now();
   const certificate = await x509.X509CertificateGenerator.createSelfSigned(
      {
         serialNumber: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex'),
         name: 'CN=Encore, O=Encore, C=GB',
         notBefore: new Date(now - 24 * 60 * 60 * 1_000),
         notAfter: new Date(now + certificateLifetimeDays * 24 * 60 * 60 * 1_000),
         signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
         keys
      },
      crypto
   );

   const privateKey = await crypto.subtle.exportKey('pkcs8', keys.privateKey);
   const privateKeyPem = createPrivateKey({ key: Buffer.from(privateKey), format: 'der', type: 'pkcs8' })
      .export({ format: 'pem', type: 'pkcs8' })
      .toString();

   return `${certificate.toString('pem')}\n${privateKeyPem}`;
}

function signingKeyError(cause: unknown) {
   return createProblem('android.apk.signing-key-failed', { cause });
}

function lengthPrefixed(contents: Buffer) {
   return Buffer.concat([uint32(contents.length), contents]);
}

function lengthPrefixedSequence(items: Buffer[]) {
   const body = Buffer.concat(items.map(lengthPrefixed));

   return Buffer.concat([uint32(body.length), body]);
}

function uint64(value: number) {
   const bytes = Buffer.alloc(8);
   bytes.writeBigUInt64LE(BigInt(value), 0);

   return bytes;
}
