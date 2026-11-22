import { Result } from 'better-result';

import { companionServiceUuid } from '@/modules/quest/contract';

import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const bluez = 'org.bluez';
const deviceInterface = 'org.bluez.Device1';

export function gdbus(args: string[]) {
   return new Promise<Result<string, Error>>((resolve) => {
      execFile('/usr/bin/gdbus', args, { encoding: 'utf8', timeout: 28_000, maxBuffer: 64 * 1024 }, (error, stdout) =>
         resolve(error ? Result.err(error) : Result.ok(stdout))
      );
   });
}

export function childNodes(xml: string) {
   return [...xml.matchAll(/<node\s+name="([^"]+)"\s*\/>/g)].flatMap((match) => (match[1] ? [match[1]] : []));
}

export async function recoverLinuxCompanionService(address: string) {
   if (!/^([\da-f]{2}:){5}[\da-f]{2}$/i.test(address)) return false;
   const introspect = async (path: string) => {
      const xml = await gdbus(['introspect', '--system', '--dest', bluez, '--object-path', path, '--xml']);
      return Result.isOk(xml) ? xml.value : '';
   };
   const property = async (path: string, iface: string, name: string) => {
      const value = await gdbus([
         'call',
         '--system',
         '--dest',
         bluez,
         '--object-path',
         path,
         '--method',
         'org.freedesktop.DBus.Properties.Get',
         iface,
         name
      ]);
      return Result.isOk(value) ? value.value.trim() : '';
   };

   const node = `dev_${address.toUpperCase().replaceAll(':', '_')}`;
   const adapters = childNodes(await introspect('/org/bluez')).filter((name) => /^hci\d+$/.test(name));
   const matches: string[] = [];
   for (const adapter of adapters) {
      if (childNodes(await introspect(`/org/bluez/${adapter}`)).includes(node)) matches.push(`/org/bluez/${adapter}/${node}`);
   }
   const [device] = matches;
   if (!device || matches.length !== 1) return false;
   if ((await property(device, deviceInterface, 'Paired')) !== '(<true>,)' || (await property(device, deviceInterface, 'Connected')) !== '(<true>,)')
      return false;

   const nodes = childNodes(await introspect(device));
   const classicOnly = !nodes.some((name) => /^service[\da-f]+$/i.test(name)) && nodes.some((name) => name === 'avrcp' || /^sep\d+$/.test(name));
   if (!classicOnly) return false;

   const connected = await gdbus([
      'call',
      '--system',
      '--dest',
      bluez,
      '--object-path',
      device,
      '--method',
      `${deviceInterface}.Connect`,
      '--timeout',
      '25'
   ]);
   if (Result.isError(connected)) return false;
   for (let attempt = 0; attempt < 32; attempt += 1) {
      if ((await property(device, deviceInterface, 'ServicesResolved')) === '(<true>,)') {
         for (const service of childNodes(await introspect(device)).filter((name) => /^service[\da-f]+$/i.test(name))) {
            if ((await property(`${device}/${service}`, 'org.bluez.GattService1', 'UUID')) === `(<'${companionServiceUuid}'>,)`) return true;
         }
      }
      await delay(250);
   }
   return false;
}
