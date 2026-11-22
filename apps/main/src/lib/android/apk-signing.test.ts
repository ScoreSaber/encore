import { Result } from 'better-result';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, test } from 'vite-plus/test';

import { withApk } from '@/lib/android/apk-archive';
import { loadApkSigningKey, signApkV2 } from '@/lib/android/apk-signing';

import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directories: string[] = [];

afterEach(async () => {
   await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function readSignature(apk: Buffer) {
   const directoryOffset = apk.readUInt32LE(apk.length - 6);
   expect(apk.toString('ascii', directoryOffset - 16, directoryOffset)).toBe('APK Sig Block 42');

   const blockStart = directoryOffset - Number(apk.readBigUInt64LE(directoryOffset - 24)) - 8;
   expect(Number(apk.readBigUInt64LE(blockStart))).toBe(Number(apk.readBigUInt64LE(directoryOffset - 24)));
   expect(apk.readUInt32LE(blockStart + 16)).toBe(0x7109871a);

   const signer = blockStart + 28;
   const signedDataLength = apk.readUInt32LE(signer);
   const signedData = apk.subarray(signer + 4, signer + 4 + signedDataLength);

   const signatures = signer + 4 + signedDataLength;
   const signatureLength = apk.readUInt32LE(signatures + 12);
   const signature = apk.subarray(signatures + 16, signatures + 16 + signatureLength);
   expect(apk.readUInt32LE(signatures + 8)).toBe(0x0103);

   const publicKey = signatures + 16 + signatureLength;
   const publicKeyDer = apk.subarray(publicKey + 4, publicKey + 4 + apk.readUInt32LE(publicKey));

   const digestLength = signedData.readUInt32LE(12);
   const digest = signedData.subarray(16, 16 + digestLength);

   return { blockStart, directoryOffset, signedData, signature, publicKeyDer, digest };
}

function chunkedDigest(sections: Buffer[]) {
   const digests: Buffer[] = [];

   for (const section of sections) {
      for (let offset = 0; offset < section.length; offset += 0x100000) {
         const chunk = section.subarray(offset, offset + 0x100000);
         const header = Buffer.alloc(5);
         header.writeUInt8(0xa5, 0);
         header.writeUInt32LE(chunk.length, 1);
         digests.push(createHash('sha256').update(header).update(chunk).digest());
      }
   }

   const header = Buffer.alloc(5);
   header.writeUInt8(0x5a, 0);
   header.writeUInt32LE(digests.length, 1);

   return createHash('sha256')
      .update(Buffer.concat([header, ...digests]))
      .digest();
}

describe('apk signing', () => {
   test('re-signs a patched apk with one stable key and a v2 signature android can verify', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'encore-apk-sign-'));
      directories.push(directory);
      const path = join(directory, 'base.apk');
      await writeFile(path, zipSync({ 'AndroidManifest.xml': Buffer.from('manifest'), 'assets/big.bin': Buffer.alloc(1_500_000, 3) }));

      const keyPath = join(directory, 'keys', 'apk-signing.pem');
      const keys = await Promise.all([loadApkSigningKey(keyPath), loadApkSigningKey(keyPath)]);
      const key = (await loadApkSigningKey(keyPath)).unwrap();
      for (const loaded of keys) expect(loaded.unwrap().privateKeyPem).toBe(key.privateKeyPem);

      const corruptPath = join(directory, 'corrupt.pem');
      await writeFile(corruptPath, 'corrupt-key');
      expect(await loadApkSigningKey(corruptPath)).toMatchObject({ status: 'error', error: { code: 'android.apk.signing-key-failed' } });
      expect(await readFile(corruptPath, 'utf8')).toBe('corrupt-key');

      for (const contents of ['first', 'second']) {
         const signed = await withApk(
            path,
            (cause) => ({ code: 'test.failed', message: String(cause) }),
            async (archive) => {
               archive.write('modded.json', Buffer.from(contents));
               await signApkV2(archive, key);
               return Result.ok();
            }
         );
         signed.unwrap();
      }

      const apk = await readFile(path);
      expect(apk.toString('latin1').split('APK Sig Block 42')).toHaveLength(2);
      const parsed = readSignature(apk);

      expect(verify('sha256', parsed.signedData, createPublicKey({ key: parsed.publicKeyDer, format: 'der', type: 'spki' }), parsed.signature)).toBe(
         true
      );

      const endOfDirectory = Buffer.from(apk.subarray(apk.length - 22));
      endOfDirectory.writeUInt32LE(parsed.blockStart, 16);
      expect(
         chunkedDigest([apk.subarray(0, parsed.blockStart), apk.subarray(parsed.directoryOffset, apk.length - 22), endOfDirectory]).equals(
            parsed.digest
         )
      ).toBe(true);

      const entries = unzipSync(apk, { filter: (file) => file.name !== 'assets/big.bin' });
      expect(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strFromU8(value)]))).toEqual({
         'AndroidManifest.xml': 'manifest',
         'modded.json': 'second'
      });
   });
});
