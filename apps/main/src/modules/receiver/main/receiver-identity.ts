import { Result } from 'better-result';
import { z } from 'zod';

import type { SecretStore } from '@/lib/security/secret-store';

import { createPrivateKey, X509Certificate } from 'node:crypto';
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

type ReceiverIdentity = {
   certificatePem: string;
   privateKeyPem: string;
   fingerprint: string;
   persisted: boolean;
};

export type ReceiverIdentityStore = ReturnType<typeof createReceiverIdentityStore>;

export function createReceiverIdentityStore(options: { secretStore: SecretStore }) {
   let identity: ReceiverIdentity | null = null;
   let loading: Promise<ReceiverIdentity> | null = null;

   function load(): Promise<ReceiverIdentity> {
      if (identity?.persisted) return Promise.resolve(identity);
      loading ??= loadOnce().finally(() => {
         loading = null;
      });
      return loading;
   }

   async function loadOnce(): Promise<ReceiverIdentity> {
      if (identity) {
         const written = await options.secretStore.write(
            identitySecretKey,
            JSON.stringify({ certificatePem: identity.certificatePem, privateKeyPem: identity.privateKeyPem })
         );
         if (Result.isOk(written)) identity = { ...identity, persisted: true };
         return identity;
      }

      const stored = await readStoredIdentity(options.secretStore);
      if (stored) {
         identity = {
            ...stored,
            fingerprint: new X509Certificate(stored.certificatePem).fingerprint256,
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

   return { load };
}

async function generateReceiverIdentity(name: string) {
   const x509 = await import('@peculiar/x509');
   const crypto = globalThis.crypto;
   x509.cryptoProvider.set(crypto);

   const keys = await crypto.subtle.generateKey(keyAlgorithm, true, ['sign', 'verify']);
   const now = Date.now();
   const cleanedName = name.replaceAll(/[^\w -]/g, '').trim();
   const certificate = await x509.X509CertificateGenerator.createSelfSigned(
      {
         serialNumber: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex'),
         name: `CN=Encore receiver ${cleanedName.length > 0 ? cleanedName.slice(0, 40) : 'device'}`,
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
   const privateKeyPem = createPrivateKey({ key: Buffer.from(privateKey), format: 'der', type: 'pkcs8' })
      .export({ format: 'pem', type: 'pkcs8' })
      .toString();

   return {
      certificatePem,
      privateKeyPem,
      fingerprint: new X509Certificate(certificatePem).fingerprint256
   };
}

async function readStoredIdentity(secretStore: SecretStore) {
   const read = await secretStore.read(identitySecretKey);
   if (Result.isError(read) || !read.value) return null;

   const contents = read.value;
   const verified = Result.try(() => {
      const stored = storedIdentitySchema.parse(JSON.parse(contents));
      return new X509Certificate(stored.certificatePem).checkPrivateKey(createPrivateKey(stored.privateKeyPem)) ? stored : null;
   });
   return Result.isOk(verified) ? verified.value : null;
}
