import type { Target, TargetClient } from '@/shared/targets';

// static placeholder until receiver pairing lands; no network behavior
export function createRemotePlaceholderTargetClient(options: { name: string }): TargetClient {
   const target: Target = {
      id: 'remote-placeholder',
      kind: 'remote',
      name: options.name,
      status: 'unpaired',
      capabilities: []
   };

   return {
      listTargets: () => Promise.resolve([target]),
      listInstalls: () => Promise.resolve([]),
      getHealth: (targetId) =>
         Promise.resolve(
            targetId === target.id
               ? {
                    status: target.status,
                    capabilities: target.capabilities
                 }
               : null
         ),
      getStoreDetection: () => Promise.resolve(null),
      rescanStores: () => Promise.resolve(null),
      onEvent: () => () => {}
   };
}
