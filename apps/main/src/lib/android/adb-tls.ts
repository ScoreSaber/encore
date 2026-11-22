import {
   ADB_DAEMON_DEFAULT_FEATURES,
   ADB_DAEMON_DEFAULT_INITIAL_PAYLOAD_SIZE,
   ADB_DAEMON_VERSION_OMIT_CHECKSUM,
   AdbCommand,
   AdbDaemonTransport,
   AdbPacket,
   AdbPacketHeader,
   calculateChecksum,
   type AdbDaemonConnection
} from '@yume-chan/adb';

import { createPrivateKey, createPublicKey, sign, X509Certificate, type KeyObject } from 'node:crypto';
import { once } from 'node:events';
import type { Socket } from 'node:net';
import { connect } from 'node:tls';

const adbTlsCommand = 0x534c5453;
const adbTlsVersion = 0x01000000;
const maxPayloadSize = 1024 * 1024;

function serializeAdbPacket(command: number, arg0: number, arg1: number, payload = new Uint8Array()) {
   return AdbPacket.serialize({
      command,
      arg0,
      arg1,
      checksum: calculateChecksum(payload),
      magic: command ^ 0xffffffff,
      payload
   });
}

function der(tag: number, ...parts: Uint8Array[]) {
   const body = Buffer.concat(parts);
   const size: number[] = [];
   for (let remaining = body.length; remaining > 0; remaining >>= 8) size.unshift(remaining & 0xff);
   return Buffer.concat([Buffer.from([tag, ...(body.length < 0x80 ? [body.length] : [0x80 | size.length, ...size])]), body]);
}

export function createAdbCertificate(privateKey: KeyObject) {
   const sha256WithRsa = Buffer.from('300d06092a864886f70d01010b0500', 'hex');
   const name = der(0x30, der(0x31, der(0x30, Buffer.from('0603550403', 'hex'), der(0x0c, Buffer.from('Encore')))));
   const validity = der(0x30, der(0x17, Buffer.from('200101000000Z')), der(0x17, Buffer.from('491231235959Z')));
   const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
   const certificate = der(0x30, der(0x02, Buffer.from([1])), sha256WithRsa, name, validity, name, publicKey);
   return new X509Certificate(der(0x30, certificate, sha256WithRsa, der(0x03, Buffer.from([0]), sign('sha256', certificate, privateKey))));
}

function readPacketHeader(socket: Socket) {
   return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const detach = () => {
         socket.off('data', receive);
         socket.off('error', fail);
         socket.off('close', fail);
      };
      function fail(cause?: Error) {
         detach();
         reject(cause ?? new Error('The device closed the ADB connection'));
      }
      function receive(chunk: Buffer) {
         chunks.push(chunk);
         const received = Buffer.concat(chunks);
         if (received.length < AdbPacketHeader.size) return;
         detach();
         socket.pause();
         if (received.length > AdbPacketHeader.size) reject(new Error('The device sent data before starting TLS'));
         else resolve(received);
      }
      socket.on('data', receive);
      socket.once('error', fail);
      socket.once('close', fail);
   });
}

export async function startAdbTls(socket: Socket, privateKey: Uint8Array) {
   const features = Buffer.from(`host::features=${ADB_DAEMON_DEFAULT_FEATURES.join(',')}`);
   const header = readPacketHeader(socket);
   socket.write(serializeAdbPacket(AdbCommand.Connect, ADB_DAEMON_VERSION_OMIT_CHECKSUM, maxPayloadSize, features));
   if ((await header).readUInt32LE(0) !== adbTlsCommand) throw new Error('The device did not offer wireless debugging TLS');
   socket.write(serializeAdbPacket(adbTlsCommand, adbTlsVersion, 0));
   const key = createPrivateKey({ key: Buffer.from(privateKey), format: 'der', type: 'pkcs8' });
   const secure = connect({
      socket,
      key: key.export({ type: 'pkcs8', format: 'pem' }),
      cert: createAdbCertificate(key).toString(),
      minVersion: 'TLSv1.3',
      rejectUnauthorized: false
   });
   await once(secure, 'secureConnect');
   return secure;
}

export async function authenticateAdbTls(serial: string, connection: AdbDaemonConnection) {
   const reader = connection.readable.getReader();
   const packet = await reader.read();
   reader.releaseLock();
   if (packet.done || packet.value.command !== AdbCommand.Connect) throw new Error('The device rejected this ADB key over wireless debugging');
   return new AdbDaemonTransport({
      serial,
      connection,
      version: Math.min(ADB_DAEMON_VERSION_OMIT_CHECKSUM, packet.value.arg0),
      maxPayloadSize: Math.min(maxPayloadSize, packet.value.arg1),
      banner: new TextDecoder().decode(packet.value.payload),
      initialDelayedAckBytes: ADB_DAEMON_DEFAULT_INITIAL_PAYLOAD_SIZE
   });
}
