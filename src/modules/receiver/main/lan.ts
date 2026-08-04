import { z } from 'zod';

import { BlockList } from 'node:net';
import { networkInterfaces } from 'node:os';

export type LanAddress = {
   host: string;
   interfaceName: string;
};

type NetworkInterfaceEntry = {
   address: string;
   family: string | number;
   internal: boolean;
};

export const wildcardInterfaceName = '*';

const privateIpv4Addresses = new BlockList();
privateIpv4Addresses.addSubnet('10.0.0.0', 8, 'ipv4');
privateIpv4Addresses.addSubnet('172.16.0.0', 12, 'ipv4');
privateIpv4Addresses.addSubnet('192.168.0.0', 16, 'ipv4');
const tailscaleIpv4Addresses = new BlockList();
tailscaleIpv4Addresses.addSubnet('100.64.0.0', 10, 'ipv4');
export const receiverIpv4AddressSchema = z
   .ipv4()
   .refine(
      (address) => tailscaleIpv4Addresses.check(address, 'ipv4') || (!/\.(?:0|255)$/.test(address) && privateIpv4Addresses.check(address, 'ipv4'))
   );

export function listLanAddresses(interfaces: Record<string, readonly NetworkInterfaceEntry[] | undefined> = networkInterfaces()) {
   const addresses: LanAddress[] = [];

   for (const [interfaceName, entries] of Object.entries(interfaces)) {
      for (const entry of entries ?? []) {
         if (entry.internal || (entry.family !== 'IPv4' && entry.family !== 4) || !receiverIpv4AddressSchema.safeParse(entry.address).success)
            continue;

         addresses.push({
            host: entry.address,
            interfaceName
         });
      }
   }

   addresses.sort((first, second) => lanInterfaceRank(first.interfaceName) - lanInterfaceRank(second.interfaceName));
   addresses.push({ host: '0.0.0.0', interfaceName: wildcardInterfaceName });

   return addresses;
}

function lanInterfaceRank(name: string) {
   if (/^(en|eth|wlan|wi-fi|wifi|ethernet)/i.test(name)) return 0;
   if (/^(bridge|utun|awdl|llw|vmnet|vboxnet|docker|zt)/i.test(name)) return 2;

   return 1;
}
