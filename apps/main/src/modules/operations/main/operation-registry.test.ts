import { describe, expect, test } from 'vite-plus/test';

import { createOperationRegistry } from '@/modules/operations/main/operation-registry';

describe('operation registry retention', () => {
   test('keeps running work and only recent terminal history', () => {
      const registry = createOperationRegistry();
      const running = registry.create({ kind: 'download', title: 'still running' });

      for (let index = 0; index < 205; index += 1) {
         const operation = registry.create({ kind: 'download', title: `finished ${index}` });
         registry.complete(operation.id);
      }

      const operations = registry.list();
      expect(operations).toHaveLength(201);
      expect(operations.some((operation) => operation.id === running.id)).toBe(true);
      expect(operations.filter((operation) => operation.status === 'completed')).toHaveLength(200);
   });
});
