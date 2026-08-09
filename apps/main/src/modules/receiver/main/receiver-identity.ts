import { Result } from 'better-result';
import { z } from 'zod';

import type { SecretStore } from '@/lib/security/secret-store';

import { X509Certificate } from 'node:crypto';
import { hostname } from 'node:os';

const identitySecretKey = 'receiver:identity';
const certificateLifetimeDays = 825;
const keyAlgorithm = {
   name: 'ECDSA',
   namedCurve: 'P-256'
};
const signingAlgorithm = {
   name: 'ECDSA',
   hash: 'SHA-256'
};

const storedIdentitySchema = z.object({
   certificatePem: z.string().includes('BEGIN CERTIFICATE'),
   privateKeyPem: z.string().includes('BEGIN PRIVATE KEY')
});

export type ReceiverIdentity = {
   certificatePem: string;
   privateKeyPem: string;
   fingerprint: string;
   persisted: boolean;
};

export type ReceiverIdentityStore = ReturnType<typeof createReceiverIdentityStore>;

export function createReceiverIdentityStore(options: { secretStore: SecretStore }) {
   let identity: ReceiverIdentity | null = null;

   async function load(): Promise<ReceiverIdentity> {
      if (identity) return identity;

      const stored = await readStoredIdentity(options.secretStore);
      if (stored) {
         identity = {
            ...stored,
            fingerprint: fingerprintOf(stored.certificatePem),
            persisted: true
         };

         return identity;
      }

      const generated = await generateReceiverIdentity(hostname());
      const written = await options.secretStore.write(
         identitySecretKey,
         JSON.stringify({
            certificatePem: generated.certificatePem,
            privateKeyPem: generated.privateKeyPem
         })
      );

      identity = {
         ...generated,
         persisted: Result.isOk(written)
      };

      return identity;
   }

   async function forget() {
      identity = null;
      await options.secretStore.remove(identitySecretKey);
   }

   return {
      load,
      forget
   };
}

export async function generateReceiverIdentity(name: string) {
   const x509 = await import('@peculiar/x509');
   const crypto = globalThis.crypto;
   x509.cryptoProvider.set(crypto);

   const keys = await crypto.subtle.generateKey(keyAlgorithm, true, ['sign', 'verify']);
   const now = Date.now();
   const certificate = await x509.X509CertificateGenerator.createSelfSigned(
      {
         serialNumber: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex'),
         name: `CN=Encore receiver ${sanitizeName(name)}`,
         notBefore: new Date(now - 60_000),
         notAfter: new Date(now + certificateLifetimeDays * 24 * 60 * 60 * 1_000),
         signingAlgorithm,
         keys,
         extensions: [
            new x509.BasicConstraintsExtension(true, 0, true),
            new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyCertSign, true),
            new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: 'encore-receiver' }])
         ]
      },
      crypto
   );

   const privateKey = await crypto.subtle.exportKey('pkcs8', keys.privateKey);
   const certificatePem = certificate.toString('pem');

   return {
      certificatePem,
      privateKeyPem: toPem('PRIVATE KEY', Buffer.from(privateKey)),
      fingerprint: fingerprintOf(certificatePem)
   };
}

export function fingerprintOf(certificatePem: string) {
   return new X509Certificate(certificatePem).fingerprint256;
}

async function readStoredIdentity(secretStore: SecretStore) {
   const read = await secretStore.read(identitySecretKey);
   if (Result.isError(read) || !read.value) return null;

   const contents = read.value;
   const decoded = Result.try({
      try: (): unknown => JSON.parse(contents),
      catch: () => null
   });
   if (Result.isError(decoded)) return null;

   const parsed = storedIdentitySchema.safeParse(decoded.value);
   return parsed.success ? parsed.data : null;
}

function toPem(label: string, contents: Buffer) {
   const body = contents
      .toString('base64')
      .replace(/(.{64})/g, '$1\n')
      .trimEnd();
   return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function sanitizeName(name: string) {
   const cleaned = name.replaceAll(/[^\w -]/g, '').trim();
   return cleaned.length > 0 ? cleaned.slice(0, 40) : 'device';
}
