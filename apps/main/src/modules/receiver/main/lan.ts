import { BlockList, isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

export type LanAddress = {
   host: string;
   interfaceName: string;
};

const wildcardInterfaceName = '*';
const wildcardIpv6InterfaceName = '*6';

const privateAddresses = new BlockList();
privateAddresses.addSubnet('10.0.0.0', 8, 'ipv4');
privateAddresses.addSubnet('172.16.0.0', 12, 'ipv4');
privateAddresses.addSubnet('192.168.0.0', 16, 'ipv4');
privateAddresses.addSubnet('100.64.0.0', 10, 'ipv4');
privateAddresses.addSubnet('fc00::', 7, 'ipv6');

export function isPrivateAddress(host: string) {
   const family = isIP(host);
   return family !== 0 && privateAddresses.check(host, family === 6 ? 'ipv6' : 'ipv4');
}

export function listLanAddresses() {
   const addresses: LanAddress[] = [];

   for (const [interfaceName, entries] of Object.entries(networkInterfaces())) {
      for (const entry of entries ?? []) {
         const family = isIP(entry.address);
         if (!family || (family === 6 && /^(fe80:|ff)/i.test(entry.address))) continue;

         addresses.push({
            host: entry.address,
            interfaceName: family === 6 ? `${interfaceName} (IPv6)` : interfaceName
         });
      }
   }

   addresses.sort((first, second) => {
      const firstLoopback = first.host === '::1' || first.host.startsWith('127.');
      const secondLoopback = second.host === '::1' || second.host.startsWith('127.');
      return (
         Number(firstLoopback) - Number(secondLoopback) ||
         isIP(first.host) - isIP(second.host) ||
         lanInterfaceRank(first.interfaceName) - lanInterfaceRank(second.interfaceName)
      );
   });
   addresses.push({ host: '0.0.0.0', interfaceName: wildcardInterfaceName });
   addresses.push({ host: '::', interfaceName: wildcardIpv6InterfaceName });

   return addresses;
}

function lanInterfaceRank(name: string) {
   if (/^(en|eth|wlan|wi-fi|wifi|ethernet)/i.test(name)) return 0;
   if (/^(bridge|utun|awdl|llw|vmnet|vboxnet|docker|zt)/i.test(name)) return 2;

   return 1;
}
