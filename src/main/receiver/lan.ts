import { networkInterfaces } from 'node:os';

export type LanAddress = {
   host: string;
   interfaceName: string;
};

export function listLanAddresses(): LanAddress[] {
   const addresses: LanAddress[] = [];

   for (const [interfaceName, entries] of Object.entries(networkInterfaces())) {
      for (const entry of entries ?? []) {
         if (entry.internal || entry.family !== 'IPv4' || !isPrivateIpv4Address(entry.address)) continue;

         addresses.push({
            host: entry.address,
            interfaceName
         });
      }
   }

   return addresses.sort((first, second) => lanInterfaceRank(first.interfaceName) - lanInterfaceRank(second.interfaceName));
}

export function isPrivateIpv4Address(address: string) {
   const parts = address.split('.').map(Number);
   if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;

   const [first = 0, second = 0] = parts;
   const last = parts[3] ?? 0;
   if (last === 0 || last === 255) return false;

   return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function lanInterfaceRank(name: string) {
   if (/^(en|eth|wlan|wi-fi|wifi|ethernet)/i.test(name)) return 0;
   if (/^(bridge|utun|awdl|llw|vmnet|vboxnet|docker|zt)/i.test(name)) return 2;

   return 1;
}
